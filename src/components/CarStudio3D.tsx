import { Suspense, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Html, Lightformer, OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { Pause, Play, RotateCcw, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { specs, simulate, type CarConfig, type Sample } from '@/lib/car';
import { normalizeVehicle, disposeVehicle } from '@/lib/vehicle-model';
import { driveSetup, newDriveState, stepDrive } from '@/lib/driving';
import toyCarAsset from '@/assets/models/toy-car.glb.asset.json';

function palette() {
  const css = getComputedStyle(document.documentElement);
  return Object.fromEntries(['studio','floor','metal','rubber','glass','sky','grass','asphalt','line','curb','warm','cool','shadow'].map(name => [name, css.getPropertyValue(`--scene-${name}`).trim()]));
}
function Model({ source, car }: { source: THREE.Group; car: CarConfig }) {
  const object = useMemo(() => normalizeVehicle(source), [source]);
  useEffect(() => () => disposeVehicle(object), [object]);
  useEffect(() => {
    object.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      for (const mat of Array.isArray(node.material) ? node.material : [node.material]) {
        if (mat instanceof THREE.MeshStandardMaterial && mat.userData.paint) mat.color.set(car.color);
      }
    });
  }, [object, car.color]);
  return <primitive object={object} dispose={null} />;
}
function DefaultModel({ car }: { car: CarConfig }) { const { scene } = useGLTF(toyCarAsset.url); return <Model source={scene} car={car} />; }
function Loader() { return <Html center><span className="bg-background/80 px-3 py-2 font-mono text-xs text-foreground">Cargando auto…</span></Html>; }

function Shadow() {
  const colors = useMemo(palette, []);
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const g = ctx.createRadialGradient(64,64,10,64,64,62);
      g.addColorStop(0,colors.shadow); g.addColorStop(.45,colors.shadow); g.addColorStop(1,'transparent');
      ctx.fillStyle = g; ctx.fillRect(0,0,128,128);
    }
    return new THREE.CanvasTexture(canvas);
  }, [colors]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <mesh rotation-x={-Math.PI/2} position-y={.009}><planeGeometry args={[2.8,5.1]}/><meshBasicMaterial map={texture} transparent opacity={.7} depthWrite={false} toneMapped={false}/></mesh>;
}
function Wheel({ x, z, car }: { x: number; z: number; car: CarConfig }) {
  const colors = useMemo(palette, []);
  const count = car.wheelStyle === 'malla' ? 12 : car.wheelStyle === 'multirayo' ? 10 : car.wheelStyle === 'disco' ? 0 : 5;
  const radius = .28 + (car.wheelSize - 15) * .01;
  return <group position={[x,radius,z]}>
    <mesh rotation-z={Math.PI/2}><cylinderGeometry args={[radius,radius,.19,32]}/><meshStandardMaterial color={colors.rubber} roughness={.9}/></mesh>
    <group position-x={Math.sign(x)*.105}>
      <mesh rotation-z={Math.PI/2}><cylinderGeometry args={[radius*.73,radius*.73,.015,32]}/><meshStandardMaterial color={count ? colors.glass : car.wheelColor} metalness={.9} roughness={.15}/></mesh>
      {Array.from({length:count},(_,i)=><mesh key={i} rotation-x={i*Math.PI/count}><boxGeometry args={[.025,radius*1.4,.033]}/><meshStandardMaterial color={car.wheelColor} metalness={.9} roughness={.1}/></mesh>)}
      <mesh rotation-z={Math.PI/2}><cylinderGeometry args={[.06,.06,.035,16]}/><meshStandardMaterial color={car.wheelColor} metalness={.9} roughness={.1}/></mesh>
    </group>
  </group>;
}
function Vehicle({ car, installed, focus, model }: { car: CarConfig; installed: boolean[]; focus: string; model?: THREE.Group | null }) {
  const colors = useMemo(palette, []);
  const mounted = installed[7] || focus === 'Carrocería' || focus === 'Ruedas' || focus === 'Prueba' || !!model;
  return <group>
    <Shadow/>
    {mounted ? <group position-y={car.rideHeight*.1} scale={[car.body==='hiper'?.97:1,.92+car.roof*.18,1]}><Suspense fallback={<Loader/>}>{model ? <Model source={model} car={car}/> : <DefaultModel car={car}/>}</Suspense></group> : <>
      <mesh position={[0,.32,0]}><boxGeometry args={[1.3,.14,3.6]}/><meshStandardMaterial color={colors.metal} metalness={.8} roughness={.32}/></mesh>
      {installed[1] && <group position={[0,.58,.85]}><mesh><boxGeometry args={[.75,.4,.9]}/><meshStandardMaterial color={colors.metal} metalness={.9} roughness={.2}/></mesh>{Array.from({length:8},(_,i)=><mesh key={i} position={[(i%2-.5)*.48,.27,(Math.floor(i/2)-1.5)*.18]}><cylinderGeometry args={[.09,.1,.24,12]}/><meshStandardMaterial color={car.accent} metalness={.8} roughness={.24}/></mesh>)}</group>}
    </>}
    {(!model || !mounted) && [-.9,.9].flatMap(x=>[-1.24,1.22].map(z=><Wheel key={`${x}-${z}`} x={x} z={z} car={car}/>))}
    {mounted && car.spoiler && <group position={[0,1.03,-1.65]}><mesh><boxGeometry args={[1.7,.05,.32]}/><meshStandardMaterial color={car.accent} metalness={.9} roughness={.1}/></mesh>{[-.55,.55].map(x=><mesh key={x} position={[x,-.19,0]}><boxGeometry args={[.035,.38,.09]}/><meshStandardMaterial color={colors.metal} metalness={.8} roughness={.3}/></mesh>)}</group>}
  </group>;
}
function Lighting({ outdoor=false }: { outdoor?: boolean }) {
  const c = useMemo(palette, []);
  return <>
    <color attach="background" args={[outdoor?c.sky:c.studio]}/>
    <fog attach="fog" args={[outdoor?c.sky:c.studio,outdoor?150:18,outdoor?650:50]}/>
    <hemisphereLight args={[c.cool,c.floor,1.4]}/>
    <directionalLight position={[8,12,6]} color={c.warm} intensity={outdoor?2:1.5}/>
    {/* One-time low resolution cubemap capture, not a per-frame environment render. */}
    <Environment resolution={128} frames={1}>
      <Lightformer intensity={3} position={[0,5,0]} rotation-x={Math.PI/2} scale={[10,8,1]} color={c.warm}/>
      <Lightformer intensity={2} position={[-5,2,0]} rotation-y={Math.PI/2} scale={[8,2,1]} color={c.cool}/>
      <Lightformer intensity={2} position={[5,2,0]} rotation-y={-Math.PI/2} scale={[8,2,1]} color={c.warm}/>
    </Environment>
  </>;
}
function Surface({ road=false }: { road?: boolean }) {
  const c = useMemo(palette, []);
  const texture = useMemo(() => {
    const canvas=document.createElement('canvas'); canvas.width=canvas.height=256;
    const ctx=canvas.getContext('2d');
    if(ctx){ctx.fillStyle=road?c.asphalt:c.floor;ctx.fillRect(0,0,256,256);ctx.fillStyle=c.line;ctx.globalAlpha=.06;for(let i=0;i<3000;i++)ctx.fillRect((i*73)%256,(i*41)%256,1,1);ctx.globalAlpha=.15;if(!road){ctx.strokeStyle=c.metal;ctx.strokeRect(0,0,256,256);} }
    const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(road?2:10,road?80:10);t.anisotropy=4;return t;
  },[c,road]);
  useEffect(()=>()=>texture.dispose(),[texture]);
  return <mesh rotation-x={-Math.PI/2} position-y={-.015}><planeGeometry args={road?[16,1400]:[80,80]}/><meshStandardMaterial map={texture} metalness={road?0:.2} roughness={road?.9:.38}/></mesh>;
}
function AdaptiveResolution({ enabled }: { enabled: boolean }) {
  const setDpr=useThree(s=>s.setDpr); const counter=useRef({time:0,frames:0});
  useFrame((_,dt)=>{if(!enabled)return;counter.current.time+=dt;counter.current.frames++;if(counter.current.time>3){const fps=counter.current.frames/counter.current.time;if(fps<48)setDpr(1);counter.current={time:0,frames:0};}});
  return null;
}
const renderer = { antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1, powerPreference: 'high-performance' as const };
export function CarStudio3D({ car, installed, focus, model }: { car: CarConfig; installed: boolean[]; focus: string; model?: THREE.Group|null }) {
  const c=useMemo(palette,[]);
  return <div className="relative h-[min(60vh,660px)] min-h-[360px] w-full bg-muted" aria-label="Taller tridimensional">
    <Canvas shadows={false} frameloop="demand" dpr={[1,1.5]} camera={{position:[5.7,2.8,6.8],fov:36}} gl={renderer} onCreated={({gl})=>{gl.shadowMap.enabled=false;}}>
      <Lighting/><Surface/>
      {[-6,6].map(x=><mesh key={x} position={[x,2.5,-7]}><boxGeometry args={[.2,5,.4]}/><meshStandardMaterial color={c.metal} metalness={.6} roughness={.4}/></mesh>)}
      <mesh position={[0,3,-8]}><boxGeometry args={[15,6,.2]}/><meshStandardMaterial color={c.floor} metalness={.2} roughness={.65}/></mesh>
      <Vehicle car={car} installed={installed} focus={focus} model={model}/>
      <OrbitControls makeDefault enablePan={false} minDistance={4.5} maxDistance={11} maxPolarAngle={1.48} target={[0,.7,0]} enableDamping/>
    </Canvas>
    <div className="pointer-events-none absolute bottom-4 left-4 border-l-2 border-primary bg-background/75 px-3 py-2 font-mono text-[10px] uppercase">{focus} · {car.name}</div>
  </div>;
}
function Roadside() {
  const c=useMemo(palette,[]);
  return <>
    <mesh rotation-x={-Math.PI/2} position-y={-.04}><planeGeometry args={[1500,1500]}/><meshStandardMaterial color={c.grass} roughness={1}/></mesh>
    <Surface road/>
    {[-8,8].map(x=><group key={x}><mesh position={[x,.02,0]} rotation-x={-Math.PI/2}><planeGeometry args={[.16,1400]}/><meshBasicMaterial color={c.line}/></mesh><mesh position={[x*1.25,.4,0]}><boxGeometry args={[.12,.8,1400]}/><meshStandardMaterial color={c.metal} metalness={.5} roughness={.5}/></mesh></group>)}
    <mesh position={[0,.012,0]} rotation-x={-Math.PI/2}><planeGeometry args={[.09,1400]}/><meshBasicMaterial color={c.line}/></mesh>
  </>;
}
function RaceCars({car,rival,me,rv}: {car:CarConfig;rival:CarConfig;me:Sample|null;rv:Sample|null}){
  const all=Array(9).fill(true);
  return <>{[[car,me,-2.5],[rival,rv,2.5]].map(([config,sample,x],i)=><group key={i} position={[x as number,0,4-Math.min((sample as Sample|null)?.x??0,402)/402*22]}><Vehicle car={config as CarConfig} installed={all} focus="Prueba"/></group>)}</>;
}
export function Race3D({car,rival,me,rv,running}: {car:CarConfig;rival:CarConfig;me:Sample|null;rv:Sample|null;running:boolean}){
  return <div className="h-[450px] w-full" aria-label="Prueba de aceleración tridimensional"><Canvas shadows={false} dpr={[1,1.5]} gl={renderer} camera={{position:[11,9,16],fov:46}} onCreated={({gl})=>{gl.shadowMap.enabled=false;}}><Lighting outdoor/><Roadside/><RaceCars car={car} rival={rival} me={me} rv={rv}/><AdaptiveResolution enabled={running}/></Canvas></div>;
}
function Driver({car,model,paused,reset,input,onSpeed}: {car:CarConfig;model?:THREE.Group|null;paused:boolean;reset:number;input:RefObject<Set<string>>;onSpeed:(speed:number)=>void}){
  const group=useRef<THREE.Group>(null);const state=useRef(newDriveState());const timer=useRef(0);const accumulator=useRef(0);
  const config=useMemo(()=>driveSetup(car,simulate(car).topSpeed),[car]);
  const target=useMemo(()=>new THREE.Vector3(),[]);const look=useMemo(()=>new THREE.Vector3(),[]);
  useEffect(()=>{state.current=newDriveState();accumulator.current=0;onSpeed(0);},[reset,onSpeed]);
  useFrame(({camera},raw)=>{
    const dt=Math.min(raw,.05);const s=state.current;
    if(!paused){const k=input.current;accumulator.current+=dt;while(accumulator.current>=1/120){stepDrive(s,{throttle:k.has('KeyW')||k.has('ArrowUp')?1:0,steer:(k.has('KeyA')||k.has('ArrowLeft')?1:0)-(k.has('KeyD')||k.has('ArrowRight')?1:0),brake:k.has('KeyS')||k.has('ArrowDown'),drift:k.has('Space')},config,1/120);accumulator.current-=1/120;}
      if(Math.abs(s.x)>7){s.x=Math.sign(s.x)*7;s.vx*=Math.exp(-8*dt);}
      if(Math.abs(s.z)>650){s.z=Math.sign(s.z)*650;s.vz=0;}
    }
    if(group.current){group.current.position.set(s.x,0,s.z);group.current.rotation.y=s.yaw;}
    target.set(s.x-Math.sin(s.yaw)*7,2.7,s.z-Math.cos(s.yaw)*7);camera.position.lerp(target,1-Math.exp(-5*dt));look.set(s.x+Math.sin(s.yaw)*5,.8,s.z+Math.cos(s.yaw)*5);camera.lookAt(look);
    timer.current+=dt;if(timer.current>.1){onSpeed(Math.round(s.speed*3.6));timer.current=0;}
  });
  return <group ref={group}><Vehicle car={car} installed={Array(9).fill(true)} focus="Prueba" model={model}/></group>;
}
export function Driving3D({car,model}: {car:CarConfig;model?:THREE.Group|null}){
  const [speed,setSpeed]=useState(0);const[paused,setPaused]=useState(false);const[reset,setReset]=useState(0);const input=useRef(new Set<string>());
  useEffect(()=>{const down=(e:KeyboardEvent)=>{if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement)return;if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)){e.preventDefault();input.current.add(e.code);}if(e.code==='Escape')setPaused(p=>!p);};const up=(e:KeyboardEvent)=>input.current.delete(e.code);const clear=()=>{input.current.clear();setPaused(true);};window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',clear);return()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',clear);};},[]);
  return <div className="relative h-[560px] w-full" aria-label="Conducción libre tridimensional">
    <Canvas shadows={false} dpr={[1,1.5]} gl={renderer} camera={{position:[0,3,-7],fov:55}} onCreated={({gl})=>{gl.shadowMap.enabled=false;}}><Lighting outdoor/><Roadside/><Driver car={car} model={model} paused={paused} reset={reset} input={input} onSpeed={setSpeed}/><AdaptiveResolution enabled={!paused}/></Canvas>
    <div className="absolute left-4 top-4 bg-background/80 p-4"><span className="font-mono text-3xl" data-testid="driving-speed">{speed}</span><span className="ml-2 text-xs text-muted-foreground">km/h</span></div>
    <div className="absolute right-4 top-4 flex gap-2"><Button size="icon" variant="secondary" title={paused?'Continuar':'Pausar'} aria-label={paused?'Continuar':'Pausar'} onClick={()=>setPaused(v=>!v)}>{paused?<Play/>:<Pause/>}</Button><Button size="icon" variant="secondary" title="Reiniciar conducción" aria-label="Reiniciar conducción" onClick={()=>{input.current.clear();setReset(v=>v+1);}}><RotateCcw/></Button></div>
    <div className="absolute bottom-4 left-4 flex gap-2">{[[ArrowLeft,'KeyA','Girar a la izquierda'],[ArrowUp,'KeyW','Acelerar'],[ArrowDown,'KeyS','Frenar'],[ArrowRight,'KeyD','Girar a la derecha']].map(([Icon,key,label])=>{const Symbol=Icon as typeof ArrowUp;return <Button key={key as string} size="icon" variant="secondary" aria-label={label as string} title={label as string} className="touch-none" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);input.current.add(key as string);}} onPointerUp={()=>input.current.delete(key as string)} onPointerCancel={()=>input.current.delete(key as string)}><Symbol/></Button>;})}</div>
    {paused&&<div className="pointer-events-none absolute inset-0 grid place-items-center"><span className="bg-background/80 px-5 py-3 font-display">PAUSA</span></div>}
  </div>;
}
