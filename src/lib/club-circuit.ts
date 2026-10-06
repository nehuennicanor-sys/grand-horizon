import * as THREE from 'three';

// A simplified, flat training interpretation of Brands Hatch's Indy layout.
// One metre per world unit; render geometry and boundaries share this curve.
export const CLUB_NAME = 'Brands Hatch · Indy';
export const CLUB_NOTE = 'Reino Unido · trazado de entrenamiento inspirado en el circuito real; versión simplificada, sin desniveles.';
export const TRACK_HALF_WIDTH = 8;
export function createClubCircuit() {
  const curve = new THREE.CatmullRomCurve3([
    [0,0,0], [0,0,135], [35,0,210], [100,0,220],
    [140,0,280], [175,0,310], [210,0,290], [195,0,245],
    [125,0,180], [65,0,140], [80,0,90], [160,0,30],
    [230,0,-25], [245,0,-95], [185,0,-150], [75,0,-145],
    [15,0,-90],
  ].map(([x,y,z]) => new THREE.Vector3(x,y,z)), true, 'centripetal');
  const points = curve.getSpacedPoints(600);
  const tangents = points.map((_,i) => curve.getTangentAt(i/600).normalize());
  const rights = tangents.map(t => new THREE.Vector3(t.z,0,-t.x));
  const spawn = curve.getPointAt(0);
  const direction = curve.getTangentAt(0);
  return { curve, points, rights, spawn, yaw: Math.atan2(direction.x,direction.z), length: curve.getLength() };
}
export type ClubCircuit = ReturnType<typeof createClubCircuit>;

export function trackRibbon(track: ClubCircuit, inner: number, outer: number, height: number) {
  const positions:number[]=[]; const uv:number[]=[]; const indices:number[]=[];
  track.points.forEach((p,i) => {
    const right = track.rights[i];
    if (!right) return;
    positions.push(p.x+right.x*inner,height,p.z+right.z*inner,p.x+right.x*outer,height,p.z+right.z*outer);
    uv.push(0,i*track.length/600/8,1,i*track.length/600/8);
    if (i<600) {const n=i*2; indices.push(n,n+2,n+1,n+1,n+2,n+3);}
  });
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  return geometry;
}

export function nearestTrack(track: ClubCircuit,x:number,z:number,previous:number) {
  let best=previous;let distance=Infinity;
  for(let offset=-24;offset<=24;offset++) {
    const index=(previous+offset+600)%600;const point=track.points[index];
    if(!point)continue;
    const d=(x-point.x)**2+(z-point.z)**2;
    if(d<distance){distance=d;best=index;}
  }
  const point=track.points[best];const right=track.rights[best];
  const lateral=point&&right?(x-point.x)*right.x+(z-point.z)*right.z:0;
  return {index:best,lateral,point,right};
}