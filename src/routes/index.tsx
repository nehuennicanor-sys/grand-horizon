import { createFileRoute } from "@tanstack/react-router";
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Armchair,
  BookOpen,
  Car,
  Check,
  ChevronRight,
  CircleDot,
  Cog,
  Coins,
  Disc3,
  Flag,
  Gauge,
  Info,
  Layers,
  Palette,
  Timer,
  TrendingUp,
  Warehouse as GarageIcon,
  Waves,
  Wind,
  Wrench,
} from "lucide-react";
import type { Group } from "three";
import { CarStudio3D, Race3D, Driving3D, CircuitPreview, Garage3D } from "@/components/CarStudio3D";
import { PartStudio } from "@/components/parts3d";
import { CIRCUIT_IDS, CIRCUITS as CIRCUIT_SPECS, DIFFICULTY_LABELS, type CircuitId } from "@/lib/club-circuit";
import { aiBand } from "@/lib/race";
import { VehicleImport } from "@/components/VehicleImport";
import { BODY_OPTIONS, bodyById } from "@/lib/bodywork";
import { loadBodyModel } from "@/lib/body-models";

import { AuthPanel, useUser } from "@/components/AuthPanel";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  defaultCar,
  gearRatios,
  handling,
  NEUTRAL_SCULPT,
  normalizeCar,
  RIVALS,
  simulate,
  specs,
  type CarConfig,
  type Category,
  type Result,
  type Sculpt,
} from "@/lib/car";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Garaje GT — Simulador 3D de autos de competición" },
      {
        name: "description",
        content:
          "Elegí una carrocería base, desarrollá motor, transmisión, chasis y aerodinámica en un taller 3D y llevalo a circuitos inspirados en pistas reales.",
      },
      { property: "og:title", content: "Garaje GT — Simulador de autos" },
      {
        property: "og:description",
        content:
          "Creá tu propio auto de competición pieza por pieza, elegí una carrocería y corré en circuitos inspirados en pistas reales.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: GarageGame,
});

const STATIONS = [
  "Proyecto",
  "Motor",
  "Transmisión",
  "Chasis",
  "Suspensión",
  "Frenos",
  "Ruedas",
  "Carrocería",
  "Interior",
] as const;
// One glyph per station for the bottom menu strip.
const STATION_ICONS = [
  BookOpen,
  Gauge,
  Cog,
  Layers,
  Waves,
  Disc3,
  CircleDot,
  Car,
  Armchair,
] as const;
const LIMITS: Record<
  Category,
  { disp: [number, number]; rpm: [number, number]; layouts: CarConfig["layout"][] }
> = {
  deportivo: {
    disp: [1.6, 5],
    rpm: [6000, 8500],
    layouts: ["I3", "I4", "I5", "I6", "V6", "V8", "H4", "R2"],
  },
  superdeportivo: {
    disp: [3, 8],
    rpm: [7000, 9500],
    layouts: ["V8", "V10", "V12", "V16", "W16", "H6", "R3"],
  },
  carreras: {
    disp: [1.6, 6.5],
    rpm: [7000, 9500],
    layouts: ["I4", "I6", "V6", "V8", "V10", "V12", "H6", "R3"],
  },
};
const GUIDES = [
  [
    "Proyecto",
    "La categoría define el rango de piezas homologadas y el punto de partida del proyecto. Podés elegir una carrocería base en la estación 8 o crear tu propia silueta con los diales de moldeado. Hay tres bases disponibles: Cupé V10, GT V8 y Turismo GT. Elegí según el tipo de circuito y tu estilo de manejo.",
  ],
  [
    "Motor",
    "Convierte combustible en movimiento. Más cilindrada da más torque; el turbo aumenta potencia con algo de lag; el atmosférico responde lineal; el eléctrico entrega torque instantáneo; el híbrido combina ambos. Para rectas largas elegí más cilindrada; para circuitos técnicos, un motor que suba de giro rápido.",
  ],
  [
    "Transmisión",
    "Lleva la fuerza del motor a las ruedas. Una relación final corta acelera mejor; una larga permite mayor velocidad punta. La manual es precisa pero lenta; la automática es cómoda; la doble embrague es rápida; la secuencial es la más rápida de todas; la CVT es suave pero menos eficiente en pista.",
  ],
  [
    "Chasis",
    "Es el esqueleto del auto. El acero es resistente y pesado; el aluminio reduce masa; el carbono ofrece máxima rigidez con el menor peso; el titanio es aún más ligero pero muy costoso; el magnesio es ligero y disipa bien las vibraciones. Menos peso mejora aceleración, frenado y curvas.",
  ],
  [
    "Suspensión",
    "Mantiene los neumáticos en contacto con el asfalto. Una puesta a punto rígida responde rápido y es ideal para pista lisa; una blanda tolera baches. La adaptativa ajusta la dureza según la superficie; la hidraulica es para uso extremo. La altura baja mejora el centro de gravedad. Para pista: baja y rígida. Para calle: media y cómoda.",
  ],
  [
    "Frenos",
    "Transforman velocidad en calor. El acero ventilado es suficiente para calle; los deportivos de 6 pistones aguantan más exigencia; los carbono-cerámicos resisten vueltas enteras sin perder eficacia. Las cerámicas son un paso intermedio. Para carreras usá carbono-cerámica; para un uso mixto, deportivos.",
  ],
  [
    "Ruedas",
    "Son el único contacto con la pista. Los eco duran mucho pero agarran poco; los performance son un buen equilibrio; los semi-slick ofrecen máximo agarre en seco; los slick son para pista pura; los de lluvia tienen surcos para agua; los todo-terreno son para tierra. Llantas grandes mejoran precisión pero agregan masa. Para pista: slick o semi-slick.",
  ],
  [
    "Carrocería",
    "Define la resistencia al aire y la carga aerodinámica. Partí de una carrocería base —Cupé V10, GT V8 o Turismo GT— o modelá tu propia silueta con los diales de largo, ancho, altura, entradas, pasarruedas y cabina. El alerón agrega agarre pero también resistencia. Para carreras: máxima carga aerodinámica. Para calle: equilibrio.",
  ],
  [
    "Interior",
    "Los asientos touring son cómodos para calle; los bucket sostienen en curvas pero son duros; los de carbono son para competencia pura. La jaula antivuelco es clave en carreras pero suma peso y quita espacio. El interior de competición elimina todo lo innecesario para ahorrar kilos.",
  ],
] as const;
const CIRCUITS = [
  {
    name: "Monza",
    country: "Italia",
    style: "Alta velocidad",
    length: 5.793,
    factor: 0.88,
    note: "Inspirado en el Templo de la Velocidad: rectas enormes, frenadas límite y baja carga aerodinámica.",
  },
  {
    name: "Spa-Francorchamps",
    country: "Bélgica",
    style: "Mixto rápido",
    length: 7.004,
    factor: 0.98,
    note: "Inspirado en Spa: Eau Rouge, subidas y curvas rápidas en el trazado más largo del calendario.",
  },
  {
    name: "Silverstone",
    country: "Reino Unido",
    style: "Curvas rápidas",
    length: 5.891,
    factor: 1.04,
    note: "Inspirado en Silverstone: enlazadas como Maggotts y Becketts que premian el balance aerodinámico.",
  },
  {
    name: "Suzuka",
    country: "Japón",
    style: "Técnico",
    length: 5.807,
    factor: 1.12,
    note: "Inspirado en Suzuka: la S de curvas, Degner y 130R exigen precisión constante.",
  },
  {
    name: "Interlagos",
    country: "Brasil",
    style: "Ondulado",
    length: 4.309,
    factor: 1.1,
    note: "Inspirado en Interlagos: corto, con subidas, bajadas y la larga curva final hacia la recta.",
  },
  {
    name: "Montecarlo",
    country: "Mónaco",
    style: "Muchas curvas",
    length: 3.337,
    factor: 1.32,
    note: "Inspirado en Mónaco: callejero lento y revirado, donde el agarre mecánico lo es todo. No son reproducciones oficiales.",
  },
] as const;

function blankCar() {
  return {
    ...defaultCar("deportivo"),
    name: "Proyecto 001",
    spoiler: false,
    stripes: false,
    rollCage: false,
  };
}

/**
 * A panel that never blanks out. If a station or a 3D view throws while
 * rendering, the user gets the reason and a way straight back instead of the
 * empty hole that used to appear where the options should be.
 */
class PanelBoundary extends Component<
  { label: string; children: ReactNode },
  { error: string | null }
> {
  override state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  override componentDidCatch(error: unknown) {
    console.error(`[taller] no se pudo mostrar ${this.props.label}`, error);
  }
  override render() {
    if (this.state.error !== null)
      return (
        <div className="flex h-full min-h-[140px] flex-col items-center justify-center gap-2.5 p-6 text-center">
          <p className="font-display text-xs tracking-widest uppercase">
            No pudimos mostrar {this.props.label}
          </p>
          <p className="max-w-[38ch] font-mono text-[10px] break-words text-muted-foreground">
            {this.state.error}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="rounded-md border border-primary/60 px-3 py-1.5 font-display text-[10px] tracking-widest uppercase text-foreground transition hover:bg-primary/15"
          >
            Reintentar
          </button>
        </div>
      );
    return this.props.children;
  }
}

function GarageGame() {
  // The prototype workshop is the game: every project starts from a blank
  // sheet, and the bodywork station can base the shell on a supplied model.
  const [car, setCar] = useState<CarConfig>(() => blankCar());
  const [station, setStation] = useState(0);
  const [installed, setInstalled] = useState(() => Array(9).fill(false) as boolean[]);
  const [mode, setMode] = useState<"workshop" | "track" | "garage">("workshop");
  const [view, setView] = useState<"pieza" | "auto">("pieza");
  const [guideOpen, setGuideOpen] = useState(false);
  const [model, setModel] = useState<Group | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelAttempt, setModelAttempt] = useState(0);
  const store = useSaved();
  const stat = useMemo(() => specs(car), [car]);
  const complete = installed.every(Boolean);
  const body = bodyById(car.bodyId);

  // Selecting a base bodywork downloads its scene once; the same cached scene
  // feeds the workshop and the track. Without one the sculpted shell is drawn.
  useEffect(() => {
    const option = bodyById(car.bodyId);
    if (!option) {
      setModel(null);
      setModelLoading(false);
      setModelError(null);
      return;
    }
    let alive = true;
    setModel(null);
    setModelLoading(true);
    setModelError(null);
    loadBodyModel(option.modelUrl, option.modelYaw ?? 0)
      .then((scene) => {
        if (!alive) return;
        setModel(scene);
        setModelLoading(false);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setModelError(cause instanceof Error ? cause.message : String(cause));
        setModelLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [car.bodyId, modelAttempt]);

  const retryModel = () => {
    setModel(null);
    setModelError(null);
    setModelAttempt((value) => value + 1);
  };
  // The stage shows the loading card while the chosen shell arrives.
  const bodyLoading = !!car.bodyId && modelLoading;
  const bodyBlocked = !!car.bodyId && (modelLoading || !!modelError);
  // Stations without a standalone component (the project sheet and the
  // bodywork, which is viewed as a whole car) fall back to the full vehicle.
  const partView = view === "pieza" && station >= 1 && station !== 7;
  const stationNumber = station + 1;
  const set = <K extends keyof CarConfig>(key: K, value: CarConfig[K]) =>
    setCar((current) => ({ ...current, [key]: value }));
  const chooseCategory = (category: Category) => {
    const l = LIMITS[category];
    const fallbackLayout = l.layouts[0];
    if (!fallbackLayout) return;
    setCar((current) => ({
      ...current,
      category,
      displacement: clamp(current.displacement, ...l.disp),
      maxRpm: clamp(current.maxRpm, ...l.rpm),
      layout: l.layouts.includes(current.layout) ? current.layout : fallbackLayout,
    }));
  };
  const install = () => {
    setInstalled((current) => current.map((value, index) => (index === station ? true : value)));
    if (station < STATIONS.length - 1) setStation((value) => value + 1);
  };
  return (
    <div className="app-grid relative flex h-screen flex-col overflow-hidden bg-background font-sans text-foreground">
      <header className="z-30 shrink-0 border-x-0 border-t-0 glass">
        <div className="brand-bar h-[3px] w-full" />
        <div className="relative z-10 mx-auto flex max-w-[1900px] flex-wrap items-center gap-1.5 gap-y-1 px-3 py-1.5 sm:px-4">
          <div className="flex shrink-0 items-center gap-2">
            <div className="gloss grid h-9 w-9 place-items-center rounded-xl bg-sel">
              <Wrench className="h-4.5 w-4.5 text-primary-foreground" />
            </div>
            <div className="leading-tight">
              <h1 className="font-display text-[21px] tracking-wide text-foreground uppercase">
                Garaje GT
              </h1>
              <p className="font-mono text-[8px] uppercase tracking-[0.22em] text-muted-foreground">
                Simulador de prototipos
              </p>
            </div>
          </div>

          <div className="mx-1 hidden h-8 w-px shrink-0 bg-border/60 sm:block" />

          <StatChip icon={<Car />} label="Proyecto" value={car.name} wide />
          <StatChip
            icon={<Gauge />}
            label="Potencia"
            value={installed[1] ? `${stat.hp} CV` : "—"}
          />
          {/* The header has to survive a 1280-wide window without clipping a
              single word, so the least important readout drops away first. */}
          <div className="hidden min-[1400px]:flex">
            <StatChip
              icon={<TrendingUp />}
              label="Índice"
              value={installed[1] ? `${stat.hpPerTon} PP` : "—"}
            />
          </div>
          <StatChip icon={<Coins />} label="Peso" value={`${stat.mass} kg`} />
          <StatChip
            icon={<Timer />}
            label="Progreso"
            value={`${installed.filter(Boolean).length}/9`}
          />

          <div className="ml-auto flex shrink-0 items-center gap-1">
            <TopButton
              active={mode === "garage"}
              onClick={() => setMode("garage")}
              icon={<GarageIcon />}
            >
              Garaje
            </TopButton>
            <TopButton
              active={mode === "workshop"}
              onClick={() => setMode("workshop")}
              icon={<Wrench />}
            >
              Taller
            </TopButton>
            <TopButton
              active={mode === "track"}
              disabled={!complete || bodyLoading}
              onClick={() => setMode("track")}
              icon={<Flag />}
            >
              Pista
            </TopButton>
          </div>
        </div>
      </header>

      {mode === "workshop" && (
        <>
          <main className="relative z-10 mx-auto flex w-full max-w-[1900px] min-h-0 flex-1 gap-3 overflow-y-auto px-3 py-3 sm:px-4">
            {/* Left rail: title, progress, quick actions and the status of the
                project. Everything the eye needs before it lands on the car. */}
            <aside className="hidden w-[232px] shrink-0 flex-col gap-2 overflow-y-auto lg:flex">
              <div className="glass rounded-xl p-3">
                <p className="font-mono text-[9px] tracking-[0.3em] text-primary uppercase">
                  Hangar 01
                </p>
                <h2 className="font-display text-[21px] leading-[1.05] tracking-normal text-foreground uppercase [overflow-wrap:anywhere]">
                  Creaciones
                </h2>
                <div className="mt-2 flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${(installed.filter(Boolean).length / 9) * 100}%` }}
                    />
                  </div>
                  <p className="font-display text-base leading-tight">
                    {installed.filter(Boolean).length}
                    <span className="text-muted-foreground">/9</span>
                  </p>
                </div>
              </div>

              <div className="glass rounded-xl">
                <div className="border-b border-white/10 px-3 py-1.5">
                  <p className="font-display text-[10px] font-bold tracking-widest text-primary">
                    ACCIONES RÁPIDAS
                  </p>
                </div>
                <div className="space-y-0.5 p-1.5">
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-start rounded-lg border-l-2 border-transparent px-2.5 py-1.5 text-left text-[11px] hover:border-primary hover:bg-primary/20 hover:text-foreground [&_svg]:h-3.5 [&_svg]:w-3.5"
                    onClick={() => setStation(7)}
                  >
                    <Palette />
                    Color de carrocería
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-start rounded-lg border-l-2 border-transparent px-2.5 py-1.5 text-left text-[11px] hover:border-primary hover:bg-primary/20 hover:text-foreground [&_svg]:h-3.5 [&_svg]:w-3.5"
                    onClick={() => {
                      setStation(7);
                      set("spoiler", !car.spoiler);
                    }}
                  >
                    <Wind />
                    Modificar alerón
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-start rounded-lg border-l-2 border-transparent px-2.5 py-1.5 text-left text-[11px] hover:border-primary hover:bg-primary/20 hover:text-foreground [&_svg]:h-3.5 [&_svg]:w-3.5"
                    onClick={() => setStation(6)}
                  >
                    <CircleDot />
                    Cambiar llantas
                  </Button>
                </div>
                <VehicleImport onModel={setModel} hasModel={!!model} />
              </div>

              <div className="glass-soft mt-auto rounded-xl p-2">
                <p className="mb-1 font-mono text-[8px] text-muted-foreground">
                  ESTADO DEL PROYECTO
                </p>
                <p
                  className={`gloss inline-block rounded-full px-2.5 py-0.5 font-display text-[13px] tracking-wide uppercase ${
                    complete ? "select-bar text-primary-foreground" : "bg-yellow text-black"
                  }`}
                >
                  {complete ? "LISTO PARA PISTA" : "EN DESARROLLO"}
                </p>
              </div>
            </aside>

            {/* Centre: the part being edited is the hero, with a switch back to
                the whole car. Everything fills the height left after the
                metrics strip, so the page never scrolls. */}
            <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto">
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden glass rounded-xl">
                <div className="flex shrink-0 items-center gap-1.5 border-b border-white/10 bg-card px-2 py-1.5">
                  {(
                    [
                      ["pieza", "Pieza en detalle"],
                      ["auto", "Auto completo"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setView(value)}
                      aria-pressed={view === value}
                      className={`rounded-md px-2.5 py-1 font-display text-[10px] tracking-wider uppercase transition ${
                        view === value
                          ? "select-bar text-primary-foreground"
                          : "text-muted-foreground hover:bg-primary/15 hover:text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  <span className="ml-auto font-mono text-[9px] text-muted-foreground uppercase">
                    Arrastrá para girar
                  </span>
                </div>
                {partView ? (
                  <PanelBoundary label="la pieza en detalle">
                    <PartStudio
                      className="min-h-[200px] flex-1"
                      station={station}
                      car={car}
                    />
                  </PanelBoundary>
                ) : (
                  <PanelBoundary label="el auto completo">
                    <div className="relative flex min-h-[200px] flex-1">
                      <CarStudio3D
                        className="min-h-[200px] flex-1"
                        car={car}
                        installed={installed}
                        focus={STATIONS[station] ?? "Proyecto"}
                        model={model}
                      />
                      {bodyBlocked && (
                        <div className="absolute inset-0 z-10 grid place-items-center bg-background/85 px-6 text-center backdrop-blur-sm">
                          <div className="max-w-[40ch]">
                            <div className="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                            <p className="font-display text-[11px] tracking-widest uppercase">
                              {modelError ? "Carrocería no disponible" : "Cargando carrocería"}
                            </p>
                            {!modelError && (
                              <p className="mt-1 font-mono text-[9px] text-muted-foreground">
                                {body?.name ?? "Modelo base"} · descarga única
                              </p>
                            )}
                            {modelError && (
                              <p className="mt-1 font-mono text-[9px] break-words text-muted-foreground">
                                {modelError}
                              </p>
                            )}
                            {modelError && (
                              <button
                                type="button"
                                onClick={retryModel}
                                className="mt-2 rounded-md border border-primary/60 px-3 py-1.5 font-display text-[9px] tracking-widest uppercase transition hover:bg-primary/15"
                              >
                                Reintentar
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </PanelBoundary>
                )}
                <div className="grid shrink-0 grid-cols-4 border-t border-white/10 bg-card">
                  <Metric label="Potencia" value={installed[1] ? stat.hp : "—"} unit="CV" />
                  <Metric label="Torque" value={installed[1] ? stat.torqueNm : "—"} unit="Nm" />
                  <Metric label="Peso" value={stat.mass} unit="kg" />
                  <Metric label="Relación" value={installed[1] ? stat.hpPerTon : "—"} unit="CV/t" />
                </div>
              </div>
              <Guide
                title={GUIDES[station]?.[0] ?? ""}
                text={GUIDES[station]?.[1] ?? ""}
                open={guideOpen}
                onToggle={() => setGuideOpen((v) => !v)}
              />
            </section>

            {/* Right rail: every option of the station at once, no inner
                scroller, with the install action pinned at the bottom. */}
            <aside className="flex w-[min(384px,36vw)] shrink-0 flex-col overflow-hidden glass rounded-xl">
              <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
                <div>
                  <p className="font-mono text-[9px] text-primary">
                    ESTACIÓN {String(stationNumber).padStart(2, "0")}
                  </p>
                  <h3 className="font-display text-sm font-bold uppercase">{STATIONS[station]}</h3>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase ${
                    installed[station] ? "bg-white/10 text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {installed[station] ? "INSTALADO" : "PENDIENTE"}
                </span>
              </div>
              {/* Keyed by station, so a long list never leaves the next station
                  scrolled past its first controls. */}
              <div key={station} className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-4">
                <PanelBoundary label={`las opciones de ${STATIONS[station] ?? "esta pieza"}`}>
                  <StationControls
                    station={station}
                    car={car}
                    set={set}
                    chooseCategory={chooseCategory}
                  />
                </PanelBoundary>
              </div>
              <div className="shrink-0 border-t border-white/10 p-3">
                <Button
                  onClick={install}
                  className="gloss h-12 w-full rounded-lg font-display text-xs font-black tracking-widest"
                >
                  {installed[station] ? "ACTUALIZAR PIEZA" : "INSTALAR PIEZA"}
                  <ChevronRight />
                </Button>
              </div>
            </aside>
          </main>

          <nav className="z-30 shrink-0 border-x-0 border-b-0 glass">
            <div className="mx-auto flex max-w-[1900px] items-stretch gap-1.5 px-3 py-1.5 sm:px-4">
              {STATIONS.map((name, index) => {
                const Icon = STATION_ICONS[index] ?? Wrench;
                const active = station === index;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setStation(index)}
                    aria-pressed={active}
                    className={`group relative flex h-[60px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl border px-1 transition duration-200 ${
                      active
                        ? "gloss select-bar border-transparent text-primary-foreground glow-primary"
                        : "glass-soft border-transparent text-muted-foreground hover:-translate-y-0.5 hover:border-primary/60 hover:text-foreground"
                    }`}
                  >
                    <span
                      className={`absolute top-1 left-1.5 font-mono text-[8px] tracking-widest ${
                        active ? "text-primary-foreground/70" : "text-yellow/70"
                      }`}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <Icon className="h-5 w-5" />
                    <span className="w-full truncate px-0.5 text-center font-display text-[10px] leading-tight tracking-wide uppercase">
                      {name}
                    </span>
                    {installed[index] && (
                      <span
                        className={`absolute top-1 right-1 grid h-3.5 w-3.5 place-items-center rounded-full ${
                          active ? "bg-primary-foreground/25" : "bg-primary/25"
                        }`}
                      >
                        <Check
                          className={`h-2.5 w-2.5 ${active ? "text-primary-foreground" : "text-primary"}`}
                        />
                      </span>
                    )}
                  </button>
                );
              })}
              {complete && (
                <button
                  type="button"
                  onClick={() => setMode("track")}
                  className="gloss flex h-[60px] shrink-0 items-center gap-2.5 rounded-xl select-bar px-5 text-primary-foreground glow-primary transition duration-200 hover:-translate-y-0.5 hover:brightness-110"
                >
                  <Flag className="h-5 w-5" />
                  <span className="font-display text-base tracking-widest uppercase">
                    Llevar a la pista
                  </span>
                </button>
              )}
            </div>
          </nav>
        </>
      )}

      {mode === "track" && <TrackMode car={car} model={model} />}
      {mode === "garage" && (
        <GarageMode
          store={store}
          onBack={() => setMode("workshop")}
          onLoad={(loaded) => {
            const saved = normalizeCar(loaded);
            setCar(saved);
            setInstalled(Array(9).fill(true));
            setStation(7);
            setMode("workshop");
          }}
        />
      )}

    </div>
  );
}

type Setter = <K extends keyof CarConfig>(key: K, value: CarConfig[K]) => void;
function StationControls({
  station,
  car,
  set,
  chooseCategory,
}: {
  station: number;
  car: CarConfig;
  set: Setter;
  chooseCategory: (c: Category) => void;
}) {
  // Belt and braces: a stored category the limits table does not know would
  // otherwise take this whole panel down before it can render a single control.
  const l = LIMITS[car.category] ?? LIMITS.deportivo;
  const sculpt: Sculpt = car.sculpt ?? NEUTRAL_SCULPT;
  const mould = (key: keyof Sculpt, value: number) =>
    set("sculpt", { ...sculpt, [key]: value });
  if (station === 0)
    return (
      <>
        <ControlTitle>Clase del proyecto</ControlTitle>
        <Options
          items={[
            ["deportivo", "Deportivo"],
            ["superdeportivo", "Superdeportivo"],
            ["carreras", "Carreras"],
          ]}
          value={car.category}
          onChange={(v) => chooseCategory(v as Category)}
        />
        <Field label="Nombre del proyecto">
          <input
            value={car.name}
            maxLength={24}
            onChange={(e) => set("name", e.target.value)}
            className="control-input"
          />
        </Field>
        <div className="rounded-lg border border-dashed border-white/15 bg-black/20 p-2.5">
          <p className="font-mono text-[8px] tracking-[0.22em] text-yellow uppercase">
            Prototipo desde cero
          </p>
          <p className="mt-1 font-mono text-[9px] leading-relaxed text-muted-foreground">
            Diseñás cada sistema del auto: motor, chasis, aerodinámica y carrocería. En la estación
            de carrocería podés elegir una base o moldear tu propia silueta.
          </p>
        </div>
      </>
    );
  if (station === 1)
    return (
      <>
        <ControlTitle>Arquitectura</ControlTitle>
        <Options
          items={l.layouts.map((x) => [x, x])}
          value={car.layout}
          onChange={(v) => set("layout", v as CarConfig["layout"])}
        />
        <Range
          label="Cilindrada"
          value={car.displacement}
          min={l.disp[0]}
          max={l.disp[1]}
          step={0.1}
          format={(v) => `${v.toFixed(1)} L`}
          onChange={(v) => set("displacement", v)}
        />
        <ControlTitle>Aspiración</ControlTitle>
        <Options
          items={[
            ["atmosferico", "Atmosférico"],
            ["turbo", "Turbo"],
            ["biturbo", "Biturbo"],
            ["compresor", "Compresor"],
            ["electrico", "Eléctrico"],
            ["hibrido", "Híbrido"],
          ]}
          value={car.aspiration}
          onChange={(v) => set("aspiration", v as CarConfig["aspiration"])}
        />
        {car.aspiration !== "atmosferico" && car.aspiration !== "electrico" && (
          <Range
            label="Presión"
            value={car.boost}
            min={0}
            max={1}
            step={0.05}
            format={(v) => `${(0.4 + v * 1.2).toFixed(1)} bar`}
            onChange={(v) => set("boost", v)}
          />
        )}
        <Range
          label="Límite de giro"
          value={car.maxRpm}
          min={l.rpm[0]}
          max={l.rpm[1]}
          step={100}
          format={(v) => `${v} rpm`}
          onChange={(v) => set("maxRpm", v)}
        />
      </>
    );
  if (station === 2)
    return (
      <>
        <ControlTitle>Caja de cambios</ControlTitle>
        <Options
          items={[
            ["manual", "Manual"],
            ["automatica", "Automática"],
            ["doble-embrague", "Doble embrague"],
            ["secuencial", "Secuencial"],
            ["cvt", "CVT"],
          ]}
          value={car.gearbox}
          onChange={(v) => set("gearbox", v as CarConfig["gearbox"])}
        />
        <Range
          label="Marchas"
          value={car.gears}
          min={4}
          // The class sets how many ratios the box has: a six-speed sequential
          // for the race cars, seven for the road GT and eight for the supercar.
          max={car.category === "carreras" ? 6 : car.category === "deportivo" ? 7 : 8}
          step={1}
          format={(v) => `${v}`}
          onChange={(v) => set("gears", v)}
        />
        <Range
          label="Relación final"
          value={car.finalDrive}
          min={2.5}
          max={4.6}
          step={0.05}
          format={(v) => `${v.toFixed(2)}:1`}
          onChange={(v) => set("finalDrive", v)}
        />
        <Options
          items={[
            ["FWD", "Delantera"],
            ["RWD", "Trasera"],
            ["AWD", "Integral"],
          ]}
          value={car.drive}
          onChange={(v) => set("drive", v as CarConfig["drive"])}
        />
        <ControlTitle>Diferencial</ControlTitle>
        <Options
          items={[
            ["abierto", "Abierto"],
            ["autoblocante", "LSD"],
            ["electronico", "Electrónico"],
            ["torque-vectoring", "Torque Vectoring"],
            ["activo", "Activo"],
          ]}
          value={car.diff}
          onChange={(v) => set("diff", v as CarConfig["diff"])}
        />
        <div className="grid grid-cols-4 gap-1">
          {gearRatios(car).map((r, i) => (
            <span key={i} className="bg-muted p-2 text-center font-mono text-[9px]">
              {i + 1}ª<br />
              {r.toFixed(2)}
            </span>
          ))}
        </div>
      </>
    );
  if (station === 3)
    return (
      <>
        <ControlTitle>Material estructural</ControlTitle>
        <Options
          items={[
            ["acero", "Acero"],
            ["aluminio", "Aluminio"],
            ["carbono", "Monocasco carbono"],
            ["titanio", "Titanio"],
            ["magnesio", "Magnesio"],
          ]}
          value={car.material}
          onChange={(v) => set("material", v as CarConfig["material"])}
        />
        <InfoBox>
          El acero es resistente y pesado; el aluminio reduce masa; el carbono ofrece máxima rigidez
          con el menor peso.
        </InfoBox>
      </>
    );
  if (station === 4)
    return (
      <>
        <ControlTitle>Puesta a punto</ControlTitle>
        <Options
          items={[
            ["confort", "GT"],
            ["deportiva", "Deportiva"],
            ["competicion", "Competición"],
            ["adaptativa", "Adaptativa"],
            ["hidraulica", "Hidráulica"],
          ]}
          value={car.suspension}
          onChange={(v) => set("suspension", v as CarConfig["suspension"])}
        />
        <Range
          label="Altura al suelo"
          value={car.rideHeight}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(60 + v * 120)} mm`}
          onChange={(v) => set("rideHeight", v)}
        />
      </>
    );
  if (station === 5)
    return (
      <>
        <ControlTitle>Sistema de frenos</ControlTitle>
        <Options
          items={[
            ["estandar", "Acero ventilado"],
            ["deportivos", "Deportivo 6 pistones"],
            ["carbono", "Carbono-cerámico"],
            ["ceramica", "Cerámica"],
            ["carbono-ceramica", "Carbono-cerámica"],
          ]}
          value={car.brakes}
          onChange={(v) => set("brakes", v as CarConfig["brakes"])}
        />
        <InfoBox>
          El diámetro y material determinan cuánto calor soporta el sistema antes de perder
          eficacia.
        </InfoBox>
      </>
    );
  if (station === 6)
    return (
      <>
        <ControlTitle>Neumáticos</ControlTitle>
        <Options
          items={[
            ["eco", "Calle"],
            ["deportivo", "Performance"],
            ["semi-slick", "Semi-slick"],
            ["slick", "Slick (pista)"],
            ["lluvia", "Lluvia"],
            ["todo-terreno", "Todo terreno"],
          ]}
          value={car.tires}
          onChange={(v) => set("tires", v as CarConfig["tires"])}
        />
        <Range
          label="Diámetro de llanta"
          value={car.wheelSize}
          min={17}
          max={22}
          step={1}
          format={(v) => `${v} pulgadas`}
          onChange={(v) => set("wheelSize", v)}
        />
        <Options
          items={[
            ["rayos", "5 rayos"],
            ["multirayo", "Multirayo"],
            ["disco", "Aero"],
            ["malla", "Malla"],
            ["turbina", "Turbina"],
            ["estrella", "Estrella"],
          ]}
          value={car.wheelStyle}
          onChange={(v) => set("wheelStyle", v as CarConfig["wheelStyle"])}
        />
        <ColorField
          label="Color de llantas"
          value={car.wheelColor}
          onChange={(v) => set("wheelColor", v)}
        />
      </>
    );
  if (station === 7)
    return (
      <>
        <BodyBasePicker value={car.bodyId} onChange={(id) => set("bodyId", id)} />
        {/* No architecture presets any more: the car is moulded. */}
        <ControlTitle>{car.bodyId ? "Ajustes del molde" : "Moldear la carrocería"}</ControlTitle>
        <div className="rounded-lg border border-primary/25 bg-primary/5 px-2.5 py-1.5">
          <p className="font-mono text-[9px] leading-relaxed text-muted-foreground uppercase">
            {car.bodyId
              ? "Los diales no cambian la silueta del modelo: ajustan peso y aerodinámica"
              : "Tu propia silueta · la clase solo fija el punto de partida"}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          <Range
            dense
            label="Largo"
            value={sculpt.length}
            min={0}
            max={1}
            step={0.05}
            format={(v) => (v < 0.34 ? "Corto" : v < 0.67 ? "Medio" : "Largo")}
            onChange={(v) => mould("length", v)}
          />
          <Range
            dense
            label="Ancho"
            value={sculpt.width}
            min={0}
            max={1}
            step={0.05}
            format={(v) => (v < 0.34 ? "Angosto" : v < 0.67 ? "Medio" : "Ancho")}
            onChange={(v) => mould("width", v)}
          />
          <Range
            dense
            label="Altura"
            value={sculpt.height}
            min={0}
            max={1}
            step={0.05}
            format={(v) => (v < 0.34 ? "Rasante" : v < 0.67 ? "Media" : "Alta")}
            onChange={(v) => mould("height", v)}
          />
          <Range
            dense
            label="Techo"
            value={car.roof}
            min={0}
            max={1}
            step={0.05}
            format={(v) => (v < 0.33 ? "Bajo" : v < 0.66 ? "Medio" : "Alto")}
            onChange={(v) => set("roof", v)}
          />
          <Range
            dense
            label="Morro"
            value={sculpt.nose}
            min={0}
            max={1}
            step={0.05}
            format={(v) => (v < 0.34 ? "Bajo" : v < 0.67 ? "Medio" : "Alto")}
            onChange={(v) => mould("nose", v)}
          />
          <Range
            dense
            label="Capó"
            value={sculpt.hood}
            min={0}
            max={1}
            step={0.05}
            format={(v) => (v < 0.34 ? "Musculoso" : v < 0.67 ? "Neutro" : "Plano")}
            onChange={(v) => mould("hood", v)}
          />
          <Range
            dense
            label="Parabrisas"
            value={sculpt.rake}
            min={0}
            max={1}
            step={0.05}
            format={(v) => (v < 0.34 ? "Parado" : v < 0.67 ? "Medio" : "Tumbado")}
            onChange={(v) => mould("rake", v)}
          />
          <Range
            dense
            label="Cabina"
            value={sculpt.cabin}
            min={0}
            max={1}
            step={0.05}
            format={(v) => (v < 0.34 ? "Adelante" : v < 0.67 ? "Central" : "Atrás")}
            onChange={(v) => mould("cabin", v)}
          />
          <Range
            dense
            label="Cola"
            value={sculpt.tail}
            min={0}
            max={1}
            step={0.05}
            format={(v) => (v < 0.34 ? "Baja" : v < 0.67 ? "Media" : "Alta")}
            onChange={(v) => mould("tail", v)}
          />
          <Range
            dense
            label="Curvas"
            value={sculpt.curves}
            min={0}
            max={1}
            step={0.05}
            format={(v) => (v < 0.34 ? "Recta" : v < 0.67 ? "Media" : "Redonda")}
            onChange={(v) => mould("curves", v)}
          />
          <Range
            dense
            label="Alerón"
            value={sculpt.wing}
            min={0}
            max={1}
            step={0.05}
            format={(v) => (v < 0.2 ? "Nulo" : v < 0.55 ? "Medio" : v < 0.8 ? "Grande" : "Carrera")}
            onChange={(v) => mould("wing", v)}
          />
          <Range
            dense
            label="Pasos"
            value={sculpt.arches}
            min={0}
            max={1}
            step={0.05}
            format={(v) => (v < 0.34 ? "Integrados" : v < 0.67 ? "Marcados" : "Abultados")}
            onChange={(v) => mould("arches", v)}
          />
        </div>
        <Range
          dense
          label="Carga aerodinámica"
          value={car.downforce}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => set("downforce", v)}
        />
        {!car.bodyId && (
          <div className="grid grid-cols-2 gap-2">
            <Toggle
              label="Alerón activo"
              active={car.spoiler}
              onClick={() => set("spoiler", !car.spoiler)}
            />
            <Toggle
              label="Librea"
              active={car.stripes}
              onClick={() => set("stripes", !car.stripes)}
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <ColorField label="Pintura" value={car.color} onChange={(v) => set("color", v)} />
          <ColorField label="Detalles" value={car.accent} onChange={(v) => set("accent", v)} />
        </div>
      </>
    );
  return (
    <>
      <ControlTitle>Cabina</ControlTitle>
      <Options
        items={[
          ["touring", "GT Touring"],
          ["bucket", "Butaca deportiva"],
          ["carbono", "Baquet carbono"],
          ["racing", "Racing"],
          ["ergonomico", "Ergonómico"],
        ]}
        value={car.seatStyle}
        onChange={(v) => set("seatStyle", v as CarConfig["seatStyle"])}
      />
      <Options
        items={[
          ["cuero", "Cuero"],
          ["alcantara", "Alcántara"],
          ["competicion", "Competición"],
          ["carbono", "Carbono"],
          ["mixto", "Mixto"],
        ]}
        value={car.interiorTrim}
        onChange={(v) => set("interiorTrim", v as CarConfig["interiorTrim"])}
      />
      <ColorField
        label="Color interior"
        value={car.interiorColor}
        onChange={(v) => set("interiorColor", v)}
      />
      <Toggle
        label="Jaula antivuelco"
        active={car.rollCage}
        onClick={() => set("rollCage", !car.rollCage)}
      />
    </>
  );
}

/**
 * Bodywork picker: the sculpted shell or one of the supplied base models. The
 * credits keep the CC attribution visible without turning the card into a
 * manufacturer badge.
 */
function BodyBasePicker({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  const selected = bodyById(value);
  const card = (active: boolean) =>
    `rounded-lg border px-2.5 py-2 text-left transition ${
      active
        ? "border-primary/70 bg-primary/15"
        : "border-white/10 bg-white/[0.03] hover:border-primary/50 hover:bg-primary/10"
    }`;
  return (
    <div className="space-y-1.5">
      <ControlTitle>Carrocería base</ControlTitle>
      <div className="grid gap-1.5">
        <button
          type="button"
          onClick={() => onChange(undefined)}
          aria-pressed={!value}
          className={card(!value)}
        >
          <span className="flex items-center gap-1.5">
            <Car className="h-3.5 w-3.5 text-primary" />
            <span className="font-display text-[11px] tracking-wide uppercase">Diseño propio</span>
            {!value && <Check className="ml-auto h-3 w-3 text-primary" />}
          </span>
          <span className="font-mono text-[8px] text-muted-foreground">
            Silueta moldeable con los diales
          </span>
        </button>
        {BODY_OPTIONS.map((body) => {
          const active = body.id === value;
          return (
            <button
              key={body.id}
              type="button"
              onClick={() => onChange(body.id)}
              aria-pressed={active}
              className={card(active)}
            >
              <span className="flex items-center gap-1.5">
                <Car className="h-3.5 w-3.5 text-primary" />
                <span className="font-display text-[11px] tracking-wide uppercase">{body.name}</span>
                {active && <Check className="ml-auto h-3 w-3 text-primary" />}
              </span>
              <span className="font-mono text-[8px] text-muted-foreground">{body.tagline}</span>
            </button>
          );
        })}
      </div>
      {selected ? (
        <p className="font-mono text-[8px] leading-relaxed text-muted-foreground">
          {selected.description}{" "}
          <a
            href={selected.credit.source}
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary underline-offset-2 hover:underline"
          >
            Modelo 3D: {selected.credit.author} · {selected.credit.license} · modificado
          </a>
        </p>
      ) : (
        <p className="font-mono text-[8px] leading-relaxed text-muted-foreground">
          Elegí una base de las disponibles o creá tu propia silueta.
        </p>
      )}
    </div>
  );
}

function TrackMode({ car, model }: { car: CarConfig; model?: Group | null }) {
  const [circuit, setCircuit] = useState<CircuitId>("deepforest");
  // null = in the pit lane; "libre" = free practice; "carrera" = the event.
  const [mode, setMode] = useState<"libre" | "carrera" | null>(null);
  const [laps, setLaps] = useState(3);
  const [level, setLevel] = useState(50);
  const info = CIRCUIT_SPECS[circuit];
  const band = aiBand(level);

  // The race takes the whole app window: no rails, no chips, nothing behind it.
  if (mode) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background">
        <div className="relative min-h-0 flex-1">
          <Driving3D
            className="h-full"
            car={car}
            model={model}
            circuit={circuit}
            race={mode === "carrera" ? { laps, level } : null}
          />
          {/* Race card, dead centre at the top: the speed readout keeps the
              left corner and the driving controls the right one, so the circuit
              name can never cover the speedometer again. */}
          <div className="pointer-events-none absolute top-3 left-1/2 flex w-[min(94%,32rem)] -translate-x-1/2 flex-col items-center gap-1">
            <span className="gloss rounded-lg border border-primary/40 bg-background/80 px-3 py-1 font-mono text-[9px] tracking-[0.2em] text-primary uppercase">
              {mode === "carrera"
                ? `Carrera · ${laps} vueltas · IA ${level} (${band.label})`
                : "Práctica libre"}
            </span>
            <span className="gloss max-w-full truncate rounded-lg border border-white/15 bg-background/80 px-3 py-1 font-display text-base tracking-widest text-foreground uppercase">
              {info.name}
            </span>
            <span className="gloss rounded-lg border border-white/15 bg-background/80 px-3 py-1 font-mono text-[9px] tracking-[0.18em] text-muted-foreground uppercase">
              {info.length.toFixed(2)} km · dificultad {DIFFICULTY_LABELS[info.difficulty]}
            </span>
            <button
              type="button"
              onClick={() => setMode(null)}
              className="gloss pointer-events-auto mt-0.5 rounded-lg select-bar px-4 py-1.5 font-display text-xs tracking-widest text-primary-foreground transition hover:brightness-110"
            >
              Salir a boxes
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <main className="relative z-10 mx-auto flex w-full max-w-[1900px] min-h-0 flex-1 gap-3 px-3 py-3 sm:px-4">
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        {/* Circuit picker laid out as a compact grid of chips, the way a racing
            game lists its events: the whole roster on screen at once. */}
        <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-4">
          {CIRCUIT_IDS.map((id) => {
            const c = CIRCUIT_SPECS[id];
            const active = circuit === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setCircuit(id)}
                aria-pressed={active}
                className={`gloss relative min-w-0 overflow-hidden rounded-xl border px-2.5 py-1.5 text-left transition duration-200 ${
                  active
                    ? "select-bar border-transparent text-primary-foreground"
                    : "glass border-transparent hover:-translate-y-0.5 hover:border-primary/60"
                }`}
              >
                <span
                  className={`block truncate font-mono text-[8px] tracking-[0.18em] uppercase ${
                    active ? "text-primary-foreground/75" : "text-muted-foreground"
                  }`}
                >
                  {c.country}
                </span>
                <span className="block truncate font-display text-[14px] leading-tight tracking-wide uppercase">
                  {c.name}
                </span>
                <span
                  className={`block truncate font-mono text-[9px] ${
                    active ? "text-primary-foreground/80" : "text-muted-foreground"
                  }`}
                >
                  {c.length.toFixed(2)} km · {DIFFICULTY_LABELS[c.difficulty]} · {c.style}
                </span>
              </button>
            );
          })}
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden glass rounded-xl">
          <Driving3D className="h-full" car={car} model={model} circuit={circuit} />
        </div>

        {/* Race setup: the laps to run and how quick the rivals are. The note
            under the dial names the band, so the setting is never a mystery. */}
        <div className="glass shrink-0 rounded-xl px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground uppercase">
                Vueltas
              </span>
              {[3, 5, 7, 9].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setLaps(n)}
                  aria-pressed={laps === n}
                  data-testid={`race-laps-${n}`}
                  className={`h-7 w-8 rounded-lg font-mono text-xs transition ${
                    laps === n
                      ? "select-bar font-semibold text-primary-foreground"
                      : "border border-white/15 text-muted-foreground hover:border-primary/60"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="flex min-w-[260px] flex-1 items-center gap-3">
              <span className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground uppercase">
                Dificultad IA
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={level}
                onChange={(e) => setLevel(Number(e.target.value))}
                aria-label="Dificultad de la IA"
                data-testid="race-level"
                className="min-w-0 flex-1 accent-primary"
              />
              <span className="font-mono text-xs text-foreground" data-testid="race-level-value">
                {level}
              </span>
              <span className="font-mono text-[10px] tracking-[0.18em] text-primary uppercase">
                {band.label}
              </span>
            </div>
          </div>
          <p className="mt-1.5 font-mono text-[10px] leading-snug text-muted-foreground">
            {band.note}
          </p>
        </div>

        <div className="flex shrink-0 gap-2 xl:hidden">
          <button
            type="button"
            onClick={() => setMode("libre")}
            className="glass flex items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 font-display text-sm tracking-widest text-foreground transition hover:border-primary/60"
          >
            Práctica libre
          </button>
          <button
            type="button"
            onClick={() => setMode("carrera")}
            className="gloss flex flex-[1.4] items-center justify-center gap-2 rounded-xl select-bar px-4 py-2.5 font-display text-sm tracking-widest text-primary-foreground glow-primary transition hover:brightness-110"
          >
            <Flag className="h-4 w-4" />
            Carrera · 20 autos
          </button>
        </div>
      </section>

      <aside className="hidden w-[300px] shrink-0 flex-col gap-3 xl:flex">
        <button
          type="button"
          onClick={() => setMode("carrera")}
          className="gloss flex shrink-0 items-center justify-center gap-2 rounded-xl select-bar px-4 py-3 font-display text-base tracking-widest text-primary-foreground glow-primary transition duration-200 hover:-translate-y-0.5 hover:brightness-110"
        >
          <Flag className="h-5 w-5" />
          Iniciar carrera (20 autos)
        </button>
        <button
          type="button"
          onClick={() => setMode("libre")}
          className="glass flex shrink-0 items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 font-display text-sm tracking-widest text-foreground transition duration-200 hover:-translate-y-0.5 hover:border-primary/60"
        >
          Práctica libre
        </button>
        <div className="glass rounded-xl px-4 py-3">
          <p className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground uppercase">
            Circuito seleccionado
          </p>
          <p className="font-display text-2xl leading-tight tracking-wide text-foreground uppercase">
            {info.name}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {info.country} · {(info.length * 1000).toFixed(0)} m · {info.style}
          </p>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{info.note}</p>
        </div>
        {/* Controls live here, on the pit wall: the track itself stays clean. */}
        <div className="glass rounded-xl px-4 py-3">
          <p className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground uppercase">
            Controles
          </p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
            <dt className="text-foreground">W</dt>
            <dd>Acelerar</dd>
            <dt className="text-foreground">S</dt>
            <dd>Frenar / reversa</dd>
            <dt className="text-foreground">A · D</dt>
            <dd>Doblar</dd>
            <dt className="text-foreground">Espacio</dt>
            <dd>Derrape</dd>
            <dt className="text-foreground">1 · 2 · 3 · C</dt>
            <dd>Cambiar cámara</dd>
            <dt className="text-foreground">ESC</dt>
            <dd>Pausa</dd>
          </dl>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden glass rounded-xl">
          <CircuitPreview circuit={circuit} className="h-full min-h-[220px]" />
        </div>
      </aside>
    </main>
  );
}

function OldTrackMode({ car, model }: { car: CarConfig; model?: Group | null }) {
  const [drive, setDrive] = useState(false);
  const [circuit, setCircuit] = useState(0);
  const [rivalIndex, setRivalIndex] = useState(1);
  const [result, setResult] = useState<{ me: Result; rival: Result } | null>(null);
  const [time, setTime] = useState(0);
  const [running, setRunning] = useState(false);
  const raf = useRef(0);
  const rival = RIVALS[rivalIndex] ?? RIVALS[0]!;
  const selectedCircuit = CIRCUITS[circuit] ?? CIRCUITS[0]!;
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  if (!rival || !selectedCircuit) return null;
  const start = () => {
    const me = simulate(car),
      rv = simulate(rival.car);
    setResult({ me, rival: rv });
    setRunning(true);
    const began = performance.now();
    const end = Math.max(me.qmTime ?? 30, rv.qmTime ?? 30) + 0.5;
    const tick = () => {
      const now = (performance.now() - began) / 1000;
      setTime(now);
      if (now < end) raf.current = requestAnimationFrame(tick);
      else setRunning(false);
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(tick);
  };
  const at = (r: Result) => r.samples.find((x) => x.t >= time) ?? r.samples.at(-1) ?? null;
  const me = result ? at(result.me) : null;
  const rv = result ? at(result.rival) : null;
  const h = result ? handling(car, result.me) : null;
  const lapTime = h ? h.lapTime * (selectedCircuit.length / 3) * selectedCircuit.factor : null;
  return (
    <main className="mx-auto max-w-[1500px] space-y-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] text-primary">CENTRO DE PRUEBAS</p>
          <h2 className="font-display text-3xl font-bold">TRACK DAY</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {CIRCUITS.map((c, i) => (
            <Button
              variant="outline"
              key={c.name}
              onClick={() => setCircuit(i)}
              className={`glass-soft h-auto flex-col items-start rounded-xl px-4 py-2 text-left ${
                circuit === i
                  ? "border-primary bg-primary/10 text-primary"
                  : "hover:border-primary/50"
              }`}
            >
              <b className="block font-display text-xs">{c.name}</b>
              <span className="text-[10px] text-muted-foreground">
                {c.country} · {c.length} km
              </span>
            </Button>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          variant={!drive ? "default" : "outline"}
          className="rounded-lg"
          onClick={() => setDrive(false)}
        >
          Prueba de aceleración
        </Button>
        <Button
          variant={drive ? "default" : "outline"}
          className="rounded-lg"
          onClick={() => {
            cancelAnimationFrame(raf.current);
            setRunning(false);
            setDrive(true);
          }}
        >
          Conducir
        </Button>
      </div>
      <section className="overflow-hidden glass-soft rounded-xl">
        <CircuitPreview />
      </section>
      {drive ? (
        <Driving3D car={car} model={model} />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[1fr_310px]">
            <section className="overflow-hidden glass-soft rounded-xl">
              <Race3D car={car} rival={rival.car} me={me} rv={rv} running={running} />
              <div className="grid grid-cols-3 border-t border-white/10">
                <Metric label="Velocidad" value={me?.v.toFixed(0) ?? 0} unit="km/h" />
                <Metric label="RPM" value={me ? Math.round(me.rpm) : 0} unit="" />
                <Metric label="Marcha" value={me?.gear ?? "N"} unit="" />
              </div>
            </section>
            <aside className="space-y-4">
              <div className="glass-soft rounded-xl p-5">
                <p className="font-mono text-[9px] text-primary">CIRCUITO SELECCIONADO</p>
                <h3 className="font-display text-xl font-bold">{selectedCircuit.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{selectedCircuit.note}</p>
              </div>
              <div className="glass-soft rounded-xl p-5">
                <ControlTitle>Rival</ControlTitle>
                {RIVALS.map((r, i) => (
                  <Button
                    variant="outline"
                    key={r.name}
                    onClick={() => setRivalIndex(i)}
                    className={`mb-2 w-full justify-start rounded-lg p-3 text-left text-sm ${rivalIndex === i ? "border-primary bg-primary/10 text-primary" : "border-white/10 hover:border-primary/50"}`}
                  >
                    {r.name}
                  </Button>
                ))}
                <Button
                  onClick={start}
                  disabled={running}
                  className="mt-3 h-12 w-full rounded-lg font-display"
                >
                  {running ? "EN PISTA…" : "INICIAR PRUEBA"}
                </Button>
              </div>
            </aside>
          </div>
          {result && !running && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Result value={result.me.t100?.toFixed(2) ?? "—"} label="0–100 km/h" unit="s" />
              <Result value={result.me.topSpeed} label="Velocidad punta" unit="km/h" />
              <Result value={result.me.qmTime?.toFixed(2) ?? "—"} label="¼ de milla" unit="s" />
              <Result value={h?.rating ?? 0} label="Manejo" unit="/100" />
              <Result
                value={lapTime ? formatLap(lapTime) : "—"}
                label={`Vuelta ${selectedCircuit.name}`}
                unit="estimada"
              />
            </div>
          )}
        </>
      )}
    </main>
  );
}

function useSaved() {
  const { user, ready } = useUser();
  const [saved, setSaved] = useState<{ id: string; car: CarConfig }[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!user) {
      setSaved([]);
      return;
    }
    supabase
      .from("car_builds")
      .select("id, config")
      .order("created_at", { ascending: false })
      .then(({ data, error }) =>
        error
          ? setError("No se pudieron cargar tus autos.")
          : setSaved(
              (data ?? []).map((row) => ({
                id: row.id,
                car: normalizeCar(row.config as Partial<CarConfig>),
              })),
            ),
      );
  }, [user]);
  const add = async (car: CarConfig) => {
    const { data, error } = await supabase
      .from("car_builds")
      .insert({ config: car as never })
      .select("id")
      .single();
    if (error) {
      setError("No se pudo guardar el auto.");
      return;
    }
    setSaved((p) => [{ id: data.id, car }, ...p]);
  };
  const remove = async (id: string) => {
    const { error } = await supabase.from("car_builds").delete().eq("id", id);
    if (error) {
      setError("No se pudo borrar el auto.");
      return;
    }
    setSaved((p) => p.filter((x) => x.id !== id));
  };
  return { user, ready, saved, error, add, remove };
}
function GarageMode({
  store,
  onLoad,
  onBack,
}: {
  store: ReturnType<typeof useSaved>;
  onLoad: (c: CarConfig) => void;
  onBack: () => void;
}) {
  if (!store.ready)
    return (
      <main className="min-h-0 flex-1 overflow-auto p-10 text-center">Cargando hangar…</main>
    );
  if (!store.user)
    return (
      <main className="mx-auto min-h-0 w-full max-w-md flex-1 overflow-auto px-5 py-12">
        <AuthPanel />
      </main>
    );
  return (
    <main className="mx-auto min-h-0 w-full max-w-[1400px] flex-1 overflow-y-auto px-4 py-7 sm:px-6">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <p className="font-mono text-[10px] text-primary">ALMACENAMIENTO EN LA NUBE</p>
          <h2 className="font-display text-3xl font-bold">MI HANGAR</h2>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack} className="rounded-lg">
            Volver al taller
          </Button>
          <Button variant="outline" onClick={() => supabase.auth.signOut()} className="rounded-lg">
            Cerrar sesión
          </Button>
        </div>
      </div>
      {store.error && <p className="mb-4 text-destructive">{store.error}</p>}
      {!store.saved.length ? (
        <div className="glass-soft rounded-xl border-dashed p-16 text-center text-muted-foreground">
          Tu hangar está vacío. Terminá un proyecto y guardalo desde el taller.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {store.saved.map((item) => {
            const s = specs(item.car);
            return (
              <article key={item.id} className="glass-soft rounded-xl">
                <Garage3D car={item.car} />
                <div className="p-5">
                  <p className="font-mono text-[9px] uppercase text-primary">{item.car.category}</p>
                  <h3 className="font-display text-xl font-bold">{item.car.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {s.hp} CV · {s.mass} kg · {item.car.drive}
                  </p>
                  <div className="mt-4 flex gap-2">
                    <Button onClick={() => onLoad(item.car)} className="rounded-lg">
                      Editar
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void store.remove(item.id)}
                      className="rounded-lg"
                    >
                      Eliminar
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}

function TopButton({
  active,
  disabled,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      disabled={disabled}
      onClick={onClick}
      className={`h-9 rounded-lg px-2.5 font-display text-[13px] font-bold uppercase tracking-wide [&_svg]:h-4 [&_svg]:w-4 ${
        active
          ? "border border-primary bg-primary text-primary-foreground hover:bg-primary/90"
          : "border border-transparent text-muted-foreground hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{children}</span>
    </Button>
  );
}

// Top-bar readout: the same data density as a racing game's menu header.
function StatChip({
  icon,
  label,
  value,
  wide,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div
      className={`hidden shrink-0 items-center gap-2 rounded-xl glass-soft px-2.5 py-1 sm:flex ${
        wide ? "min-w-[150px]" : ""
      }`}
    >
      <span className="text-primary [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      <span className="min-w-0 leading-tight">
        <span className="block font-mono text-[8px] tracking-[0.16em] text-muted-foreground uppercase">
          {label}
        </span>
        <span className="block truncate font-display text-[15px] tracking-wide uppercase">
          {value}
        </span>
      </span>
    </div>
  );
}
function Guide({
  title,
  text,
  open,
  onToggle,
}: {
  title: string;
  text: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="glass-soft rounded-xl">
      <button onClick={onToggle} className="flex w-full items-center gap-3 p-4 text-left">
        <BookOpen className="h-4 w-4 text-primary" />
        <div>
          <p className="font-mono text-[9px] text-primary">ACADEMIA GARAJE GT</p>
          <b className="font-display text-xs">¿PARA QUÉ SIRVE {title.toUpperCase()}?</b>
        </div>
        <Info className="ml-auto h-4 w-4 text-muted-foreground" />
      </button>
      {open && (
        <p className="border-t border-white/10 px-5 py-4 text-sm leading-relaxed text-muted-foreground">
          {text}
        </p>
      )}
    </div>
  );
}
function Metric({ label, value, unit }: { label: string; value: string | number; unit: string }) {
  return (
    <div className="border-r border-white/10 p-3 last:border-0">
      <p className="font-mono text-[8px] uppercase text-muted-foreground">{label}</p>
      <p className="font-display text-lg font-bold">
        {value}
        <span className="ml-1 text-[9px] text-muted-foreground">{unit}</span>
      </p>
    </div>
  );
}
function Result({ value, label, unit }: { value: string | number; label: string; unit: string }) {
  return (
    <div className="glass-soft rounded-xl p-5">
      <p className="font-display text-2xl font-bold text-primary">
        {value}
        <span className="ml-1 text-xs">{unit}</span>
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
function ControlTitle({ children }: { children: ReactNode }) {
  return (
    <p className="font-display text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
      {children}
    </p>
  );
}
function Options({
  items,
  value,
  onChange,
}: {
  items: readonly (readonly [string, string])[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5 xl:grid-cols-3">
      {items.map(([key, label]) => {
        const on = value === key;
        return (
          <Button
            key={key}
            type="button"
            variant={on ? "default" : "outline"}
            onClick={() => onChange(key)}
            aria-pressed={on}
            className={`h-9 min-w-0 rounded-lg px-2 text-[11px] font-medium whitespace-nowrap ${
              on ? "gloss glow-primary" : ""
            }`}
          >
            <span className="truncate">{label}</span>
          </Button>
        );
      })}
    </div>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
function Range({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  dense = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  /** Compact row: used where a station packs many dials on one screen. */
  dense?: boolean;
}) {
  return (
    <label className="block">
      <span
        className={`flex justify-between text-muted-foreground ${dense ? "mb-0.5 text-[10px]" : "mb-2 text-xs"}`}
      >
        <span>{label}</span>
        <b className="font-mono text-primary">{format(value)}</b>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
    </label>
  );
}
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-xs text-muted-foreground">
      {label}
      <span className="mt-1 flex h-10 items-center gap-2 border border-white/10 px-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-6 w-8 cursor-pointer border-0 bg-transparent"
        />
        <span className="font-mono text-[10px]">{value}</span>
      </span>
    </label>
  );
}
function Toggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? "default" : "outline"}
      onClick={onClick}
      className="w-full justify-between rounded-lg"
    >
      {label}
      {active ? <Check /> : <span className="h-4 w-4 border border-current" />}
    </Button>
  );
}
function InfoBox({ children }: { children: ReactNode }) {
  return (
    <p className="border-l-2 border-primary bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const formatLap = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
