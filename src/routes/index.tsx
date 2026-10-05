import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { BookOpen, Check, ChevronRight, Flag, Info, Sparkles, Warehouse as GarageIcon, Wrench, Palette, CircleDot, Wind } from "lucide-react";
import type { Group } from "three";
import { CarStudio3D, Race3D, Driving3D } from "@/components/CarStudio3D";
import { VehicleImport } from "@/components/VehicleImport";
import { CarPhoto } from "@/components/CarPhoto";
import { AuthPanel, useUser } from "@/components/AuthPanel";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { aiDesignCar } from "@/lib/ai-build.functions";
import { defaultCar, gearRatios, handling, normalizeCar, RIVALS, simulate, specs, type CarConfig, type Category, type Result } from "@/lib/car";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Garage Lab — Simulador 3D de construcción automotriz" },
    { name: "description", content: "Construí un deportivo pieza por pieza en un taller 3D, aprendé mecánica y probalo en circuitos inspirados en pistas reales." },
    { property: "og:title", content: "Garage Lab — Juego de construcción automotriz 3D" },
    { property: "og:description", content: "Diseñá motor, chasis, transmisión, interior y carrocería; guardá tu auto y llevalo a la pista." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: GarageGame,
});

const STATIONS = ["Proyecto", "Motor", "Transmisión", "Chasis", "Suspensión", "Frenos", "Ruedas", "Carrocería", "Interior"] as const;
const LIMITS: Record<Category, { disp: [number, number]; rpm: [number, number]; layouts: CarConfig["layout"][] }> = {
  deportivo: { disp: [1.6, 5], rpm: [6000, 8500], layouts: ["I4", "I6", "V6", "V8"] },
  superdeportivo: { disp: [3, 8], rpm: [7000, 9500], layouts: ["V8", "V10", "V12", "W16"] },
  carreras: { disp: [1.6, 5.5], rpm: [7000, 9500], layouts: ["I4", "V6", "V8", "V10"] },
};
const GUIDES = [
  ["Proyecto", "La categoría define el rango de piezas homologadas. Deportivo prioriza equilibrio; Superdeportivo, potencia y tecnología; Carreras elimina compromisos de calle."],
  ["Motor", "Convierte combustible en movimiento. Más cilindrada suele dar más torque; turbo aumenta potencia, mientras un motor atmosférico responde de forma más lineal."],
  ["Transmisión", "Lleva la fuerza del motor a las ruedas. Una relación final corta acelera mejor; una larga permite mayor velocidad punta."],
  ["Chasis", "Es el esqueleto del auto. Menos peso mejora aceleración, frenado y curvas, pero los materiales avanzados son propios de proyectos extremos."],
  ["Suspensión", "Mantiene los neumáticos en contacto con el asfalto. Una puesta a punto rígida responde rápido, aunque tolera menos los baches."],
  ["Frenos", "Transforman velocidad en calor. Los carbono-cerámicos resisten vueltas exigentes sin perder eficacia."],
  ["Ruedas", "Son el único contacto con la pista. Los semi-slick ofrecen más agarre en seco; llantas grandes mejoran precisión pero agregan masa."],
  ["Carrocería", "Define la resistencia al aire y la carga aerodinámica. Un alerón agrega agarre rápido, pero también resistencia y peso."],
  ["Interior", "Asientos, revestimientos y jaula cambian peso, seguridad y propósito. Una jaula es clave en carreras, pero innecesaria en un gran turismo."],
] as const;
const CIRCUITS = [
  { name: "Monza", country: "Italia", style: "Alta velocidad", length: 5.793, factor: 0.88, note: "Inspirado en el Templo de la Velocidad: rectas enormes, frenadas límite y baja carga aerodinámica." },
  { name: "Spa-Francorchamps", country: "Bélgica", style: "Mixto rápido", length: 7.004, factor: 0.98, note: "Inspirado en Spa: Eau Rouge, subidas y curvas rápidas en el trazado más largo del calendario." },
  { name: "Silverstone", country: "Reino Unido", style: "Curvas rápidas", length: 5.891, factor: 1.04, note: "Inspirado en Silverstone: enlazadas como Maggotts y Becketts que premian el balance aerodinámico." },
  { name: "Suzuka", country: "Japón", style: "Técnico", length: 5.807, factor: 1.12, note: "Inspirado en Suzuka: la S de curvas, Degner y 130R exigen precisión constante." },
  { name: "Interlagos", country: "Brasil", style: "Ondulado", length: 4.309, factor: 1.1, note: "Inspirado en Interlagos: corto, con subidas, bajadas y la larga curva final hacia la recta." },
  { name: "Montecarlo", country: "Mónaco", style: "Muchas curvas", length: 3.337, factor: 1.32, note: "Inspirado en Mónaco: callejero lento y revirado, donde el agarre mecánico lo es todo. No son reproducciones oficiales." },
] as const;

function blankCar() { return { ...defaultCar("deportivo"), name: "Proyecto 001", spoiler: false, stripes: false, rollCage: false }; }

function GarageGame() {
  const [car, setCar] = useState<CarConfig>(blankCar);
  const [station, setStation] = useState(0);
  const [installed, setInstalled] = useState(() => Array(9).fill(false) as boolean[]);
  const [mode, setMode] = useState<"workshop" | "track" | "garage">("workshop");
  const [guideOpen, setGuideOpen] = useState(true);
  const [model, setModel] = useState<Group | null>(null);
  const store = useSaved();
  const stat = useMemo(() => specs(car), [car]);
  const complete = installed.every(Boolean);
  const set = <K extends keyof CarConfig>(key: K, value: CarConfig[K]) => setCar((current) => ({ ...current, [key]: value }));
  const chooseCategory = (category: Category) => {
    const l = LIMITS[category];
    const fallbackLayout = l.layouts[0];
    if (!fallbackLayout) return;
    setCar((current) => ({ ...current, category, displacement: clamp(current.displacement, ...l.disp), maxRpm: clamp(current.maxRpm, ...l.rpm), layout: l.layouts.includes(current.layout) ? current.layout : fallbackLayout }));
  };
  const install = () => {
    setInstalled((current) => current.map((value, index) => index === station ? true : value));
    if (station < STATIONS.length - 1) setStation((value) => value + 1);
  };
  return <div className="min-h-screen bg-background font-sans text-foreground">
    <header className="border-b border-border bg-card/95">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center border border-primary bg-primary/10"><Wrench className="h-4 w-4 text-primary" /></div><div><h1 className="font-display text-base font-black">GARAGE <span className="text-primary">LAB</span></h1><p className="font-mono text-[9px] text-muted-foreground">AUTOMOTIVE ENGINEERING SIMULATOR</p></div></div>
        <div className="flex items-center gap-1">
          <TopButton active={mode === "workshop"} onClick={() => setMode("workshop")} icon={<Wrench />}>Taller</TopButton>
          <TopButton active={mode === "track"} disabled={!complete} onClick={() => setMode("track")} icon={<Flag />}>Pista</TopButton>
          <TopButton active={mode === "garage"} onClick={() => setMode("garage")} icon={<GarageIcon />}>Garaje</TopButton>
        </div>
      </div>
    </header>

    {mode === "workshop" && <main className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div><p className="font-mono text-[10px] uppercase text-primary">Hangar 01 · Banco de desarrollo</p><h2 className="font-display text-2xl font-bold sm:text-3xl">CONSTRUÍ TU MÁQUINA</h2></div>
        <div className="flex items-center gap-3 font-mono text-xs"><span className="text-muted-foreground">PROGRESO</span><div className="h-1.5 w-32 bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${installed.filter(Boolean).length / 9 * 100}%` }} /></div><b>{installed.filter(Boolean).length}/9</b></div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[230px_minmax(0,1fr)_370px]">
        <aside className="border border-border bg-card">
          <div className="border-b border-border p-4"><p className="font-display text-xs font-bold tracking-widest">ESTACIONES</p></div>
          <nav className="p-2">{STATIONS.map((name, index) => <Button variant="ghost" key={name} onClick={() => setStation(index)} className={`mb-1 h-auto flex w-full justify-start gap-3 rounded-none border-l-2 px-3 py-3 text-left transition ${station === index ? "border-primary bg-primary/10 text-primary" : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"}`}><span className="grid h-6 w-6 place-items-center border border-current font-mono text-[10px]">{installed[index] ? <Check className="h-3 w-3" /> : String(index + 1).padStart(2, "0")}</span><span className="font-display text-[11px] font-bold uppercase tracking-wide">{name}</span><ChevronRight className="ml-auto h-3 w-3" /></Button>)}</nav>
          <div className="space-y-1 border-t border-border p-3"><Button variant="ghost" className="h-auto w-full justify-start rounded-none whitespace-normal text-left text-xs" onClick={()=>setStation(7)}><Palette/>Cambiar Color de Carrocería</Button><Button variant="ghost" className="w-full justify-start rounded-none text-xs" onClick={()=>setStation(6)}><CircleDot/>Cambiar Llantas</Button><Button variant="ghost" className="w-full justify-start rounded-none text-xs" onClick={()=>{setStation(7);set("spoiler",!car.spoiler);}}><Wind/>Modificar Alerón</Button></div>
          <VehicleImport onModel={setModel} hasModel={!!model}/>
          <div className="m-3 border border-border bg-background p-3"><p className="mb-1 font-mono text-[9px] text-muted-foreground">ESTADO DEL PROYECTO</p><p className={`font-display text-xs font-bold ${complete ? "text-accent" : "text-primary"}`}>{complete ? "LISTO PARA PISTA" : "EN DESARROLLO"}</p></div>
        </aside>

        <section className="min-w-0 space-y-4">
          <div className="overflow-hidden border border-border bg-card"><CarStudio3D car={car} installed={installed} focus={STATIONS[station] ?? "Proyecto"} model={model}/><div className="grid grid-cols-4 border-t border-border bg-card"><Metric label="Potencia" value={installed[1] ? stat.hp : "—"} unit="CV"/><Metric label="Torque" value={installed[1] ? stat.torqueNm : "—"} unit="Nm"/><Metric label="Peso" value={stat.mass} unit="kg"/><Metric label="Relación" value={installed[1] ? stat.hpPerTon : "—"} unit="CV/t"/></div></div>
          <Guide title={GUIDES[station]?.[0] ?? ""} text={GUIDES[station]?.[1] ?? ""} open={guideOpen} onToggle={() => setGuideOpen((v) => !v)} />
        </section>

        <aside className="border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><p className="font-mono text-[9px] text-primary">ESTACIÓN {String(station + 1).padStart(2,"0")}</p><h3 className="font-display text-sm font-bold uppercase">{STATIONS[station]}</h3></div><span className="font-mono text-[10px] text-muted-foreground">{installed[station] ? "INSTALADO" : "PENDIENTE"}</span></div>
          <div className="max-h-[650px] space-y-5 overflow-y-auto p-5"><StationControls station={station} car={car} set={set} chooseCategory={chooseCategory} onAi={(next) => { setCar(next); setInstalled(Array(9).fill(true)); }} /></div>
          <div className="border-t border-border p-4"><Button onClick={install} className="h-12 w-full rounded-none font-display text-xs font-black tracking-widest">{installed[station] ? "ACTUALIZAR PIEZA" : "INSTALAR PIEZA"}<ChevronRight /></Button></div>
        </aside>
      </div>
    </main>}

    {mode === "track" && <TrackMode car={car} model={model}/>}
    {mode === "garage" && <GarageMode store={store} onLoad={(loaded) => { setCar(normalizeCar(loaded)); setInstalled(Array(9).fill(true)); setMode("workshop"); setStation(7); }} />}

    {complete && mode === "workshop" && <div className="fixed bottom-5 left-1/2 z-20 -translate-x-1/2"><Button onClick={() => setMode("track")} size="lg" className="rounded-none shadow-glow"><Flag /> LLEVAR A LA PISTA</Button></div>}
  </div>;
}

type Setter = <K extends keyof CarConfig>(key: K, value: CarConfig[K]) => void;
function StationControls({ station, car, set, chooseCategory, onAi }: { station: number; car: CarConfig; set: Setter; chooseCategory: (c: Category) => void; onAi: (c: CarConfig) => void }) {
  const l = LIMITS[car.category];
  if (station === 0) return <><AiEngineer onBuild={onAi}/><ControlTitle>Clase del proyecto</ControlTitle><Options items={[["deportivo","Deportivo"],["superdeportivo","Superdeportivo"],["carreras","Carreras"]]} value={car.category} onChange={(v) => chooseCategory(v as Category)} /><Field label="Nombre del proyecto"><input value={car.name} maxLength={24} onChange={(e) => set("name", e.target.value)} className="control-input" /></Field></>;
  if (station === 1) return <><ControlTitle>Arquitectura</ControlTitle><Options items={l.layouts.map((x) => [x,x])} value={car.layout} onChange={(v) => set("layout", v as CarConfig["layout"])} /><Range label="Cilindrada" value={car.displacement} min={l.disp[0]} max={l.disp[1]} step={.1} format={(v) => `${v.toFixed(1)} L`} onChange={(v) => set("displacement",v)}/><ControlTitle>Aspiración</ControlTitle><Options items={[["atmosferico","Atmosférico"],["turbo","Turbo"],["biturbo","Biturbo"],["compresor","Compresor"]]} value={car.aspiration} onChange={(v) => set("aspiration",v as CarConfig["aspiration"])}/>{car.aspiration !== "atmosferico" && <Range label="Presión" value={car.boost} min={0} max={1} step={.05} format={(v) => `${(.4+v*1.2).toFixed(1)} bar`} onChange={(v)=>set("boost",v)}/>}<Range label="Límite de giro" value={car.maxRpm} min={l.rpm[0]} max={l.rpm[1]} step={100} format={(v)=>`${v} rpm`} onChange={(v)=>set("maxRpm",v)}/></>;
  if (station === 2) return <><ControlTitle>Caja de cambios</ControlTitle><Options items={[["manual","Manual"],["automatica","Automática"],["doble-embrague","Doble embrague"]]} value={car.gearbox} onChange={(v)=>set("gearbox",v as CarConfig["gearbox"])}/><Range label="Marchas" value={car.gears} min={4} max={8} step={1} format={(v)=>`${v}`} onChange={(v)=>set("gears",v)}/><Range label="Relación final" value={car.finalDrive} min={2.5} max={4.6} step={.05} format={(v)=>`${v.toFixed(2)}:1`} onChange={(v)=>set("finalDrive",v)}/><Options items={[["FWD","Delantera"],["RWD","Trasera"],["AWD","Integral"]]} value={car.drive} onChange={(v)=>set("drive",v as CarConfig["drive"])}/><ControlTitle>Diferencial</ControlTitle><Options items={[["abierto","Abierto"],["autoblocante","LSD"],["electronico","Electrónico"]]} value={car.diff} onChange={(v)=>set("diff",v as CarConfig["diff"])}/><div className="grid grid-cols-4 gap-1">{gearRatios(car).map((r,i)=><span key={i} className="bg-muted p-2 text-center font-mono text-[9px]">{i+1}ª<br/>{r.toFixed(2)}</span>)}</div></>;
  if (station === 3) return <><ControlTitle>Material estructural</ControlTitle><Options items={[["acero","Acero"],["aluminio","Aluminio"],["carbono","Monocasco carbono"]]} value={car.material} onChange={(v)=>set("material",v as CarConfig["material"])}/><InfoBox>El acero es resistente y pesado; el aluminio reduce masa; el carbono ofrece máxima rigidez con el menor peso.</InfoBox></>;
  if (station === 4) return <><ControlTitle>Puesta a punto</ControlTitle><Options items={[["confort","GT"],["deportiva","Deportiva"],["competicion","Competición"]]} value={car.suspension} onChange={(v)=>set("suspension",v as CarConfig["suspension"])}/><Range label="Altura al suelo" value={car.rideHeight} min={0} max={1} step={.05} format={(v)=>`${Math.round(60+v*120)} mm`} onChange={(v)=>set("rideHeight",v)}/></>;
  if (station === 5) return <><ControlTitle>Sistema de frenos</ControlTitle><Options items={[["estandar","Acero ventilado"],["deportivos","Deportivo 6 pistones"],["carbono","Carbono-cerámico"]]} value={car.brakes} onChange={(v)=>set("brakes",v as CarConfig["brakes"])}/><InfoBox>El diámetro y material determinan cuánto calor soporta el sistema antes de perder eficacia.</InfoBox></>;
  if (station === 6) return <><ControlTitle>Neumáticos</ControlTitle><Options items={[["eco","Calle"],["deportivo","Performance"],["semi-slick","Semi-slick"]]} value={car.tires} onChange={(v)=>set("tires",v as CarConfig["tires"])}/><Range label="Diámetro de llanta" value={car.wheelSize} min={17} max={22} step={1} format={(v)=>`${v} pulgadas`} onChange={(v)=>set("wheelSize",v)}/><Options items={[["rayos","5 rayos"],["multirayo","Multirayo"],["disco","Aero"],["malla","Malla"]]} value={car.wheelStyle} onChange={(v)=>set("wheelStyle",v as CarConfig["wheelStyle"])}/><ColorField label="Color de llantas" value={car.wheelColor} onChange={(v)=>set("wheelColor",v)}/></>;
  if (station === 7) return <><ControlTitle>Arquitectura exterior</ControlTitle><Options items={[["sedan","GT musculoso"],["coupe","Coupé de motor central"],["hiper","Hiperauto"]]} value={car.body} onChange={(v)=>set("body",v as CarConfig["body"])}/><Range label="Perfil del techo" value={car.roof} min={0} max={1} step={.05} format={(v)=>v<.33?"Bajo":v<.66?"Medio":"Alto"} onChange={(v)=>set("roof",v)}/><Range label="Carga aerodinámica" value={car.downforce} min={0} max={1} step={.05} format={(v)=>`${Math.round(v*100)}%`} onChange={(v)=>set("downforce",v)}/><Toggle label="Alerón activo" active={car.spoiler} onClick={()=>set("spoiler",!car.spoiler)}/><Toggle label="Librea de competición" active={car.stripes} onClick={()=>set("stripes",!car.stripes)}/><div className="grid grid-cols-2 gap-3"><ColorField label="Pintura" value={car.color} onChange={(v)=>set("color",v)}/><ColorField label="Detalles" value={car.accent} onChange={(v)=>set("accent",v)}/></div><CarPhoto car={car}/></>;
  return <><ControlTitle>Cabina</ControlTitle><Options items={[["touring","GT Touring"],["bucket","Butaca deportiva"],["carbono","Baquet carbono"]]} value={car.seatStyle} onChange={(v)=>set("seatStyle",v as CarConfig["seatStyle"])}/><Options items={[["cuero","Cuero"],["alcantara","Alcántara"],["competicion","Competición"]]} value={car.interiorTrim} onChange={(v)=>set("interiorTrim",v as CarConfig["interiorTrim"])}/><ColorField label="Color interior" value={car.interiorColor} onChange={(v)=>set("interiorColor",v)}/><Toggle label="Jaula antivuelco" active={car.rollCage} onClick={()=>set("rollCage",!car.rollCage)}/></>;
}

function TrackMode({ car, model }: { car: CarConfig; model?: Group|null }) {
  const [drive, setDrive] = useState(false);
  const [circuit, setCircuit] = useState(0); const [rivalIndex,setRivalIndex]=useState(1); const [result,setResult]=useState<{me:Result;rival:Result}|null>(null); const [time,setTime]=useState(0); const [running,setRunning]=useState(false); const raf=useRef(0); const rival=RIVALS[rivalIndex] ?? RIVALS[0]; const selectedCircuit=CIRCUITS[circuit] ?? CIRCUITS[0];
  if (!rival || !selectedCircuit) return null;
  const start=()=>{const me=simulate(car),rv=simulate(rival.car);setResult({me,rival:rv});setRunning(true);const began=performance.now();const end=Math.max(me.qmTime??30,rv.qmTime??30)+.5;const tick=()=>{const now=(performance.now()-began)/1000;setTime(now);if(now<end)raf.current=requestAnimationFrame(tick);else setRunning(false)};cancelAnimationFrame(raf.current);raf.current=requestAnimationFrame(tick)};
  useEffect(()=>()=>cancelAnimationFrame(raf.current),[]); const at=(r:Result)=>r.samples.find(x=>x.t>=time)??r.samples.at(-1)??null; const me=result?at(result.me):null;const rv=result?at(result.rival):null;const h=result?handling(car,result.me):null;const lapTime=h? h.lapTime*(selectedCircuit.length/3)*selectedCircuit.factor:null;
  return <main className="mx-auto max-w-[1500px] space-y-5 px-4 py-6 sm:px-6"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="font-mono text-[10px] text-primary">CENTRO DE PRUEBAS</p><h2 className="font-display text-3xl font-bold">TRACK DAY</h2></div><div className="flex flex-wrap gap-2">{CIRCUITS.map((c,i)=><Button variant="outline" key={c.name} onClick={()=>setCircuit(i)} className={`h-auto flex-col items-start rounded-none px-4 py-2 text-left ${circuit===i?"border-primary bg-primary/10":"border-border bg-card"}`}><b className="block font-display text-xs">{c.name}</b><span className="text-[10px] text-muted-foreground">{c.country} · {c.length} km</span></Button>)}</div></div><div className="flex gap-2"><Button variant={!drive?"default":"outline"} className="rounded-none" onClick={()=>setDrive(false)}>Prueba de aceleración</Button><Button variant={drive?"default":"outline"} className="rounded-none" onClick={()=>{cancelAnimationFrame(raf.current);setRunning(false);setDrive(true);}}>Conducir</Button></div>{drive?<Driving3D car={car} model={model}/>:<><div className="grid gap-4 lg:grid-cols-[1fr_310px]"><section className="overflow-hidden border border-border bg-card"><Race3D car={car} rival={rival.car} me={me} rv={rv} running={running}/><div className="grid grid-cols-3 border-t border-border"><Metric label="Velocidad" value={me?.v.toFixed(0)??0} unit="km/h"/><Metric label="RPM" value={me?Math.round(me.rpm):0} unit=""/><Metric label="Marcha" value={me?.gear??"N"} unit=""/></div></section><aside className="space-y-4"><div className="border border-border bg-card p-5"><p className="font-mono text-[9px] text-primary">CIRCUITO SELECCIONADO</p><h3 className="font-display text-xl font-bold">{selectedCircuit.name}</h3><p className="mt-1 text-sm text-muted-foreground">{selectedCircuit.note}</p></div><div className="border border-border bg-card p-5"><ControlTitle>Rival</ControlTitle>{RIVALS.map((r,i)=><Button variant="outline" key={r.name} onClick={()=>setRivalIndex(i)} className={`mb-2 w-full justify-start rounded-none p-3 text-left text-sm ${rivalIndex===i?"border-primary text-primary":"border-border"}`}>{r.name}</Button>)}<Button onClick={start} disabled={running} className="mt-3 h-12 w-full rounded-none font-display">{running?"EN PISTA…":"INICIAR PRUEBA"}</Button></div></aside></div>{result&&!running&&<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Result value={result.me.t100?.toFixed(2)??"—"} label="0–100 km/h" unit="s"/><Result value={result.me.topSpeed} label="Velocidad punta" unit="km/h"/><Result value={result.me.qmTime?.toFixed(2)??"—"} label="¼ de milla" unit="s"/><Result value={h?.rating??0} label="Manejo" unit="/100"/><Result value={lapTime?formatLap(lapTime):"—"} label={`Vuelta ${selectedCircuit.name}`} unit="estimada"/></div>}</>}</main>;
}

function useSaved(){const {user,ready}=useUser();const[saved,setSaved]=useState<{id:string;car:CarConfig}[]>([]);const[error,setError]=useState<string|null>(null);useEffect(()=>{if(!user){setSaved([]);return}supabase.from("car_builds").select("id, config").order("created_at",{ascending:false}).then(({data,error})=>error?setError("No se pudieron cargar tus autos."):setSaved((data??[]).map(row=>({id:row.id,car:normalizeCar(row.config as Partial<CarConfig>)}))))},[user]);const add=async(car:CarConfig)=>{const{data,error}=await supabase.from("car_builds").insert({config:car as never}).select("id").single();if(error){setError("No se pudo guardar el auto.");return}setSaved(p=>[{id:data.id,car},...p])};const remove=async(id:string)=>{const{error}=await supabase.from("car_builds").delete().eq("id",id);if(error){setError("No se pudo borrar el auto.");return}setSaved(p=>p.filter(x=>x.id!==id))};return{user,ready,saved,error,add,remove}}
function GarageMode({store,onLoad}:{store:ReturnType<typeof useSaved>;onLoad:(c:CarConfig)=>void}){if(!store.ready)return <main className="p-10 text-center">Cargando hangar…</main>;if(!store.user)return <main className="mx-auto max-w-md px-5 py-12"><AuthPanel/></main>;return <main className="mx-auto max-w-[1400px] px-4 py-7 sm:px-6"><div className="mb-6 flex items-end justify-between"><div><p className="font-mono text-[10px] text-primary">ALMACENAMIENTO EN LA NUBE</p><h2 className="font-display text-3xl font-bold">MI HANGAR</h2></div><Button variant="outline" onClick={()=>supabase.auth.signOut()} className="rounded-none">Cerrar sesión</Button></div>{store.error&&<p className="mb-4 text-destructive">{store.error}</p>}{!store.saved.length?<div className="border border-dashed border-border p-16 text-center text-muted-foreground">Tu hangar está vacío. Terminá un proyecto y guardalo desde el taller.</div>:<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{store.saved.map(item=>{const s=specs(item.car);return <article key={item.id} className="border border-border bg-card"><CarStudio3D car={item.car} installed={Array(9).fill(true)} focus="Hangar"/><div className="p-5"><p className="font-mono text-[9px] uppercase text-primary">{item.car.category}</p><h3 className="font-display text-xl font-bold">{item.car.name}</h3><p className="text-sm text-muted-foreground">{s.hp} CV · {s.mass} kg · {item.car.drive}</p><div className="mt-4 flex gap-2"><Button onClick={()=>onLoad(item.car)} className="rounded-none">Editar</Button><Button variant="outline" onClick={()=>void store.remove(item.id)} className="rounded-none">Eliminar</Button></div></div></article>})}</div>}</main>}

function AiEngineer({onBuild}:{onBuild:(c:CarConfig)=>void}){const run=useServerFn(aiDesignCar);const[text,setText]=useState("");const[loading,setLoading]=useState(false);const[error,setError]=useState<string|null>(null);const go=async()=>{setLoading(true);setError(null);try{const r=await run({data:{description:text}});if(!r.ok){setError(r.error);return}onBuild(normalizeCar({...r.build,wheelStyle:"rayos",rideHeight:r.build.category==="deportivo"?.35:.12,roof:r.build.body==="hiper"?.25:.45,interiorColor:"#17191d",seatStyle:"carbono",interiorTrim:r.build.category==="carreras"?"competicion":"alcantara",rollCage:r.build.category==="carreras"}))}catch{setError("El ingeniero virtual no respondió. Intentá nuevamente.")}finally{setLoading(false)}};return <div className="border border-primary/40 bg-primary/5 p-4"><div className="mb-2 flex items-center gap-2 text-primary"><Sparkles className="h-4 w-4"/><b className="font-display text-xs">INGENIERO IA</b></div><textarea value={text} onChange={e=>setText(e.target.value)} rows={3} maxLength={800} placeholder="Describí el auto que querés construir…" className="control-input resize-none"/><Button size="sm" onClick={go} disabled={loading||text.trim().length<5} className="mt-2 rounded-none">{loading?"CALCULANDO…":"GENERAR BASE"}</Button>{error&&<p className="mt-2 text-xs text-destructive">{error}</p>}</div>}

function TopButton({active,disabled,onClick,icon,children}:{active:boolean;disabled?:boolean;onClick:()=>void;icon:ReactNode;children:ReactNode}){return <Button variant={active?"default":"ghost"} disabled={disabled} onClick={onClick} className="rounded-none px-3 text-xs [&_svg]:h-4 [&_svg]:w-4">{icon}<span className="hidden sm:inline">{children}</span></Button>}
function Guide({title,text,open,onToggle}:{title:string;text:string;open:boolean;onToggle:()=>void}){return <div className="border border-border bg-card"><button onClick={onToggle} className="flex w-full items-center gap-3 p-4 text-left"><BookOpen className="h-4 w-4 text-primary"/><div><p className="font-mono text-[9px] text-primary">ACADEMIA GARAGE LAB</p><b className="font-display text-xs">¿PARA QUÉ SIRVE {title.toUpperCase()}?</b></div><Info className="ml-auto h-4 w-4 text-muted-foreground"/></button>{open&&<p className="border-t border-border px-5 py-4 text-sm leading-relaxed text-muted-foreground">{text}</p>}</div>}
function Metric({label,value,unit}:{label:string;value:string|number;unit:string}){return <div className="border-r border-border p-3 last:border-0"><p className="font-mono text-[8px] uppercase text-muted-foreground">{label}</p><p className="font-display text-lg font-bold">{value}<span className="ml-1 text-[9px] text-muted-foreground">{unit}</span></p></div>}
function Result({value,label,unit}:{value:string|number;label:string;unit:string}){return <div className="border border-border bg-card p-5"><p className="font-display text-2xl font-bold text-primary">{value}<span className="ml-1 text-xs">{unit}</span></p><p className="text-xs text-muted-foreground">{label}</p></div>}
function ControlTitle({children}:{children:ReactNode}){return <p className="font-display text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{children}</p>}
function Options({items,value,onChange}:{items:readonly (readonly [string,string])[];value:string;onChange:(v:string)=>void}){return <div className="grid grid-cols-2 gap-2">{items.map(([key,label])=><Button key={key} type="button" variant={value===key?"default":"outline"} onClick={()=>onChange(key)} className="h-auto min-h-10 rounded-none whitespace-normal px-2 text-[11px]">{label}</Button>)}</div>}
function Field({label,children}:{label:string;children:ReactNode}){return <label className="block"><span className="mb-1 block text-xs text-muted-foreground">{label}</span>{children}</label>}
function Range({label,value,min,max,step,format,onChange}:{label:string;value:number;min:number;max:number;step:number;format:(v:number)=>string;onChange:(v:number)=>void}){return <label className="block"><span className="mb-2 flex justify-between text-xs text-muted-foreground"><span>{label}</span><b className="font-mono text-primary">{format(value)}</b></span><input type="range" value={value} min={min} max={max} step={step} onChange={e=>onChange(Number(e.target.value))} className="w-full accent-primary"/></label>}
function ColorField({label,value,onChange}:{label:string;value:string;onChange:(v:string)=>void}){return <label className="block text-xs text-muted-foreground">{label}<span className="mt-1 flex h-10 items-center gap-2 border border-border px-2"><input type="color" value={value} onChange={e=>onChange(e.target.value)} className="h-6 w-8 cursor-pointer border-0 bg-transparent"/><span className="font-mono text-[10px]">{value}</span></span></label>}
function Toggle({label,active,onClick}:{label:string;active:boolean;onClick:()=>void}){return <Button type="button" variant={active?"default":"outline"} onClick={onClick} className="w-full justify-between rounded-none">{label}{active?<Check/>:<span className="h-4 w-4 border border-current"/>}</Button>}
function InfoBox({children}:{children:ReactNode}){return <p className="border-l-2 border-primary bg-muted p-3 text-xs leading-relaxed text-muted-foreground">{children}</p>}
const clamp=(v:number,min:number,max:number)=>Math.min(max,Math.max(min,v));const formatLap=(seconds:number)=>`${Math.floor(seconds/60)}:${(seconds%60).toFixed(2).padStart(5,"0")}`;
