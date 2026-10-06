import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { trackRibbon, TRACK_HALF_WIDTH, type ClubCircuit } from '@/lib/club-circuit';

function surfaceTexture(base:string,detail:string,repeat:number,curbs=false) {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
  const ctx=canvas.getContext('2d');
  if(ctx){
    ctx.fillStyle=base;ctx.fillRect(0,0,256,256);
    ctx.fillStyle=detail;
    if(curbs){ctx.fillRect(0,0,256,128);}else{ctx.globalAlpha=.15;for(let i=0;i<6000;i++)ctx.fillRect((i*83)%256,(i*137)%256,1,1);}
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(repeat,repeat);texture.anisotropy=4;
  return texture;
}
export function Circuit3D({track}:{track:ClubCircuit}) {
  const colors=useMemo(()=>{const css=getComputedStyle(document.documentElement);const get=(n:string)=>css.getPropertyValue(`--scene-${n}`).trim();return {asphalt:get('asphalt'),grass:get('grass'),line:get('line'),curb:get('curb'),metal:get('metal'),rubber:get('rubber'),floor:get('floor')};},[]);
  const road=useMemo(()=>surfaceTexture(colors.asphalt,colors.line,1),[colors]);
  const grass=useMemo(()=>surfaceTexture(colors.grass,colors.floor,70),[colors]);
  const curb=useMemo(()=>surfaceTexture(colors.curb,colors.line,1,true),[colors]);
  const meshes=useMemo(()=>[
    trackRibbon(track,-TRACK_HALF_WIDTH,TRACK_HALF_WIDTH,.02),
    trackRibbon(track,-8.2,-8,.035),trackRibbon(track,8,8.2,.035),
    trackRibbon(track,-9.2,-8.2,.04),trackRibbon(track,8.2,9.2,.04),
    trackRibbon(track,-13,-12.5,.65),trackRibbon(track,12.5,13,.65),
  ],[track]);
  useEffect(()=>()=>{road.dispose();grass.dispose();curb.dispose();meshes.forEach(g=>g.dispose());},[road,grass,curb,meshes]);
  return <group>
    <mesh rotation-x={-Math.PI/2} position={[120,-.08,70]}><planeGeometry args={[1400,1400]}/><meshStandardMaterial map={grass} roughness={1}/></mesh>
    {meshes.map((geometry,i)=><mesh key={i} geometry={geometry}><meshStandardMaterial map={i===0?road:i===3||i===4?curb:null} color={i===0||i===3||i===4?colors.line:i>4?colors.metal:colors.line} roughness={i>4?.4:.9} metalness={i>4?.5:0} side={THREE.DoubleSide}/></mesh>)}
    {/* Start grid, pit lane and continuous safety barriers. */}
    <mesh position={[-14,.025,35]} rotation-x={-Math.PI/2}><planeGeometry args={[8,110]}/><meshStandardMaterial map={road} roughness={.9}/></mesh>
    {Array.from({length:16},(_,i)=><mesh key={i} position={[-7.5+i,.05,15]} rotation-x={-Math.PI/2}><planeGeometry args={[1,1.5]}/><meshBasicMaterial color={i%2?colors.rubber:colors.line}/></mesh>)}
    {Array.from({length:6},(_,i)=><group key={i} position={[i%2?3:-3,.05,-8-Math.floor(i/2)*8]}><mesh rotation-x={-Math.PI/2}><planeGeometry args={[2,.1]}/><meshBasicMaterial color={colors.line}/></mesh></group>)}
    <group position={[-24,0,45]}>
      <mesh position={[0,2.5,0]}><boxGeometry args={[9,5,65]}/><meshStandardMaterial color={colors.floor} roughness={.8}/></mesh>
      <mesh position={[4.6,2,0]}><boxGeometry args={[.1,2,61]}/><meshStandardMaterial color={colors.metal} metalness={.5} roughness={.3}/></mesh>
      <mesh position={[0,5.2,0]}><boxGeometry args={[12,.3,68]}/><meshStandardMaterial color={colors.line}/></mesh>
    </group>
    <group position={[0,0,18]}>
      {[-11,11].map(x=><mesh key={x} position={[x,3,0]}><boxGeometry args={[.4,6,.4]}/><meshStandardMaterial color={colors.metal} metalness={.6}/></mesh>)}
      <mesh position={[0,5.6,0]}><boxGeometry args={[23,1,.5]}/><meshStandardMaterial color={colors.floor}/></mesh>
      {[-1.2,-.6,0,.6,1.2].map(x=><mesh key={x} position={[x,5.6,-.3]}><sphereGeometry args={[.18,12,8]}/><meshBasicMaterial color={colors.curb}/></mesh>)}
    </group>
  </group>;
}