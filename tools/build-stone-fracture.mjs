// 从现有石头表面提取凸包平面，离线切成 20 个封闭 Voronoi 碎块。
// 游戏只加载紧凑顶点数据，无额外 FBX、贴图或物理引擎。
import fs from 'node:fs/promises';
import { editorCall } from './editor-bridge-client.mjs';
const {result:raw}=await editorCall('execute_javascript',{context:'scene',code:`const m=await new Promise((r,j)=>cc.assetManager.loadAny({uuid:'91a4976f-22b0-4184-aaa0-96762147bed4@e10e4'},(e,a)=>e?j(e):r(a)));return {p:Array.from(m.readAttribute(0,cc.gfx.AttributeName.ATTR_POSITION)),i:Array.from(m.readIndices(0))};`});
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],unit=a=>a.map(v=>v/Math.hypot(...a));
const points=[];for(let i=0;i<raw.p.length;i+=3)points.push([raw.p[i]/.02,raw.p[i+2]/.006,-raw.p[i+1]/.02]);
const planes=[];
for(let i=0;i<raw.i.length;i+=3){const [a,b,c]=raw.i.slice(i,i+3).map(v=>points[v]);let n=unit(cross(sub(b,a),sub(c,a))),d=dot(n,a);if(d<0){n=n.map(v=>-v);d=-d;}if(!planes.some(p=>Math.abs(p.d-d)<1e-5&&dot(p.n,n)>.99999))planes.push({n,d});}
const unique=pts=>pts.filter((a,i)=>!pts.slice(0,i).some(b=>Math.hypot(...sub(a,b))<1e-6));
function clip(faces,n,d){
    const out=[],cap=[];
    for(const face of faces){const poly=[];for(let i=0;i<face.length;i++){
        const a=face[i],b=face[(i+1)%face.length],da=dot(n,a)-d,db=dot(n,b)-d;
        if(da<=1e-7)poly.push(a);
        if((da<0&&db>0)||(da>0&&db<0)){const p=a.map((v,k)=>v+(b[k]-v)*da/(da-db));poly.push(p);cap.push(p);}
    }const clean=unique(poly);if(clean.length>=3)out.push(clean);}
    const ring=unique(cap);
    if(ring.length>=3){const center=[0,1,2].map(k=>ring.reduce((s,p)=>s+p[k],0)/ring.length),u=unit(cross(n,Math.abs(n[1])<.9?[0,1,0]:[1,0,0])),v=cross(n,u);
        ring.sort((a,b)=>Math.atan2(dot(sub(a,center),v),dot(sub(a,center),u))-Math.atan2(dot(sub(b,center),v),dot(sub(b,center),u)));out.push(ring);}
    return out;
}
let base=[[[ -1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1]],[[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1]],[[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]],[[-1,1,-1],[-1,1,1],[1,1,1],[1,1,-1]],[[-1,-1,-1],[-1,1,-1],[1,1,-1],[1,-1,-1]],[[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]];
for(const p of planes)base=clip(base,p.n,p.d);
const seeds=Array.from({length:20},(_,i)=>[
    -.4+(i%5)*.2+Math.sin(i*2.37)*.045,
    Math.sin(i*3.13+.7)*.14,
    -.375+Math.floor(i/5)*.25+Math.cos(i*1.73)*.05,
]);
let triangles=0;
const chunks=seeds.map((seed,i)=>{
    let faces=base;
    seeds.forEach((b,j)=>{if(i!==j)faces=clip(faces,sub(b,seed),(dot(b,b)-dot(seed,seed))/2);});
    const pts=unique(faces.flat()),center=[0,1,2].map(k=>pts.reduce((s,p)=>s+p[k],0)/pts.length);
    const polygons=faces.map(face=>face.map(p=>pts.findIndex(v=>Math.hypot(...sub(v,p))<1e-6)));
    triangles+=polygons.reduce((s,p)=>s+p.length-2,0);
    return {c:center.map(v=>+v.toFixed(5)),p:pts.flatMap(p=>sub(p,center).map(v=>+v.toFixed(5))),f:polygons};
});
const source='// 原石头离线切割数据；'+chunks.length+' 个封闭碎块，共 '+triangles+' 个三角面。\nexport const ROCK_CHUNKS = '+JSON.stringify(chunks)+';\n';
await fs.writeFile('assets/TS/RockFractureGeometry.ts',source);
console.log({chunks:chunks.length,triangles,sourceBytes:Buffer.byteLength(source),planes:planes.length});
