import fs from 'node:fs/promises';
import { editorCall } from './editor-bridge-client.mjs';
const dir='assets/模型/金币建造',models=[];
for(const file of await fs.readdir(dir))if(/\.(fbx)\.meta$/i.test(file)){
    const meta=JSON.parse(await fs.readFile(`${dir}/${file}`,'utf8'));
    models.push({name:file.replace(/\.meta$/,''),uuid:Object.values(meta.subMetas).find(v=>v.importer==='gltf-scene').uuid});
}
const result=await editorCall('execute_javascript',{context:'scene',code:`
const models=${JSON.stringify(models)},out=[];
for(const n of [...cc.director.getScene().children])if(models.some(m=>m.name.replace(/\\.fbx$/i,'')===n.name))n.destroy();
for(const item of models){
 const prefab=await new Promise((r,j)=>cc.assetManager.loadAny({uuid:item.uuid},(e,a)=>e?j(e):r(a)));
 const root=cc.instantiate(prefab);root.parent=cc.director.getScene();
 const entries=[];
 for(const r of root.getComponentsInChildren(cc.MeshRenderer)){
  const points=[];
  for(let s=0;s<r.mesh.struct.primitives.length;s++){
   const a=r.mesh.readAttribute(s,cc.gfx.AttributeName.ATTR_POSITION);
   for(let i=0;i<a.length;i+=3){const p=new cc.Vec3(a[i],a[i+1],a[i+2]);cc.Vec3.transformMat4(p,p,r.node.worldMatrix);points.push(p);}
  }
  entries.push({name:r.node.name,scale:r.node.scale,position:r.node.position,rotation:r.node.eulerAngles,materials:r.sharedMaterials.map(m=>m?({name:m.name,color:m.getProperty('mainColor')}):null),min:['x','y','z'].map(k=>Math.min(...points.map(p=>p[k]))),max:['x','y','z'].map(k=>Math.max(...points.map(p=>p[k]))),vertices:points.length});
 }
 out.push({...item,entries});root.destroy();
}
return out;`},60000);
await fs.writeFile('tools/coin-reference/model-info.json',JSON.stringify(result.result,null,2));
console.log(JSON.stringify(result.result,null,2));
