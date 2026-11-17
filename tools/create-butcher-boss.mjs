import fs from 'node:fs/promises';
import { editorCall } from './editor-bridge-client.mjs';
const modelMeta=JSON.parse(await fs.readFile('assets/模型/Boss/屠夫/屠夫_模型.fbx.meta','utf8'));
const model=Object.values(modelMeta.subMetas).find(v=>v.importer==='gltf-scene').uuid;
const actions={Move:'6925c170-25e1-465e-b888-cd4129377ee8@083c5',Attack:'c8dbc572-1fab-4258-92e5-abbab76c5832@083c5',Dead:'970ad95c-bda2-4f9c-a2cf-f060506875ff@083c5'};
await fs.mkdir('assets/模型/Boss/屠夫/动作',{recursive:true});
await fs.mkdir('assets/模型/Boss/屠夫/材质',{recursive:true});
await editorCall('execute_javascript',{context:'editor',code:"await Editor.Message.request('asset-db','refresh-asset','db://assets/模型/Boss/屠夫');return true;"});
const code=`
const load=id=>new Promise((r,j)=>cc.assetManager.loadAny({uuid:id},(e,a)=>e?j(e):r(a)));
const save=async(url,asset)=>{
    const text=JSON.stringify(JSON.parse(EditorExtends.serialize(asset)));
    let uuid=await Editor.Message.request('asset-db','query-uuid',url);
    if(uuid)await Editor.Message.request('asset-db','save-asset',url,text);
    else uuid=(await Editor.Message.request('asset-db','create-asset',url,text)).uuid;
    await Editor.Message.request('asset-db','refresh-asset',url);
    const cached=cc.assetManager.assets.get(uuid);if(cached)cc.assetManager.releaseAsset(cached);return uuid;
};
const expand=async prefab=>{const data=JSON.parse(EditorExtends.serialize(prefab));for(const item of data){if(item?.__type__==='cc.Node')item._prefab=null;else if(item&&'__prefab' in item)item.__prefab=null;}return cc.instantiate((await EditorExtends.deserializeFull(data)).data);};
const stale=[];cc.assetManager.assets.forEach(asset=>{if(asset.uuid.startsWith('${modelMeta.uuid}'))stale.push(asset);});stale.forEach(asset=>cc.assetManager.releaseAsset(asset));
const root=await expand(await load('0880d8b6-72e9-4aee-8082-c204a6c67012'));
root.active=false;root.name='屠夫Boss';
try{
    root.children.filter(n=>n.getComponentInChildren(cc.SkinnedMeshRenderer)).forEach(n=>{n.removeFromParent();n.destroy();});
    const model=await expand(await load('${model}'));model.name='屠夫模型与动画';root.addChild(model);model.setScale(1.15,1.15,1.15);
    const meshes=model.getComponentsInChildren(cc.SkinnedMeshRenderer);
    for(const r of meshes){if(!r.skeleton?.joints.every(p=>!p||model.getChildByPath(p)))throw Error('骨骼路径不一致');r.skinningRoot=model;}
    const clips=[],report=[];
    for(const [name,id] of Object.entries(${JSON.stringify(actions)})){
        // 导入源已经移到 tools/backups；日后只调整模型或材质时复用独立动画资源。
        if(!await Editor.Message.request('asset-db','query-url',id.split('@')[0])){
            const uuid=await Editor.Message.request('asset-db','query-uuid','db://assets/模型/Boss/屠夫/动作/'+name+'.anim');
            if(!uuid)throw Error('缺少 '+name+' 动画，请先重新导入桌面的对应动作');
            const clip=await load(uuid);clips.push(clip);report.push({name,uuid,duration:clip.duration,reused:true});continue;
        }
        const original=await load(id),data=JSON.parse(EditorExtends.serialize(original));data[0]._hash=0;
        const exotic=data[data[0]._exoticAnimation.__id__];
        exotic._nodeAnimations=exotic._nodeAnimations.filter(ref=>!!model.getChildByPath(data[ref.__id__]._path));
        let before=0,after=0;
        for(const ref of exotic._nodeAnimations){const node=data[ref.__id__];for(const key of ['_position','_rotation','_scale']){
            const track=node[key]&&data[node[key].__id__];if(!track)continue;
            const values=data[track.values.__id__],times=track.times.array,raw=values._values.array;
            if(!times||!raw||values._isQuantized)throw Error('未支持的动画数据');
            const size=key==='_rotation'?4:3,eps=key==='_rotation'?.0005:key==='_scale'?.00001:.0002;
            const kept=new Set([0,times.length-1]);before+=times.length;
            const reduce=(lo,hi)=>{
                if(hi-lo<2)return;let best=-1,worst=eps;
                for(let i=lo+1;i<hi;i++){
                    const t=(times[i]-times[lo])/(times[hi]-times[lo]);let error=0;
                    if(size===4){const q=new cc.Quat(),a=new cc.Quat(...raw.slice(lo*4,lo*4+4)),b=new cc.Quat(...raw.slice(hi*4,hi*4+4));cc.Quat.slerp(q,a,b,t);const actual=new cc.Quat(...raw.slice(i*4,i*4+4));error=2*Math.acos(Math.min(1,Math.abs(cc.Quat.dot(q,actual))));}
                    else for(let k=0;k<size;k++)error=Math.max(error,Math.abs(raw[i*size+k]-(raw[lo*size+k]+(raw[hi*size+k]-raw[lo*size+k])*t)));
                    if(error>worst){worst=error;best=i;}
                }
                if(best>=0){kept.add(best);reduce(lo,best);reduce(best,hi);}
            };reduce(0,times.length-1);
            const indices=[...kept].sort((a,b)=>a-b);after+=indices.length;
            track.times.array=indices.map(i=>+times[i].toFixed(6));values._values.array=indices.flatMap(i=>raw.slice(i*size,i*size+size).map(v=>+v.toFixed(6)));
        }}
        const clip=cc.deserialize(data);clip.name=name;clip.events=name==='Attack'?[{frame:clip.duration*.58,func:'attackHit',params:[]}]:[];
        clip.wrapMode=name==='Move'?cc.AnimationClip.WrapMode.Loop:cc.AnimationClip.WrapMode.Normal;
        const uuid=await save('db://assets/模型/Boss/屠夫/动作/'+name+'.anim',clip);clips.push(await load(uuid));report.push({name,uuid,duration:clip.duration,keysBefore:before,keysAfter:after});
    }
    const animation=model.getComponent(cc.SkeletalAnimation)??model.addComponent(cc.SkeletalAnimation);animation.clips=clips;animation.defaultClip=clips[0];animation.playOnLoad=false;animation.useBakedAnimation=true;
    const binder=root.getComponent(cc.js.getClassByName('角色动画绑定'));binder.actionNames=['Move','Attack','Dead'];binder.autoPlay=false;
    const textureIds={Body:'e55356c6-e3df-490e-9daf-5e611aef9b41@6c48a',Weapon:'5884815b-eaa9-4985-a77f-29d39600134f@6c48a'};
    const materialCache=new Map();
    for(const renderer of meshes){const materials=[];for(const source of renderer.sharedMaterials){
        const name=source.name;let saved=materialCache.get(name);
        if(!saved){const textureId=textureIds[name];if(!textureId)throw Error('未知材质 '+name);const m=new cc.Material();m.initialize({effectName:'builtin-toon',defines:{USE_OUTLINE_PASS:true,USE_BASE_COLOR_MAP:true,BASE_COLOR_MAP_AS_SHADE_MAP_1:true,BASE_COLOR_MAP_AS_SHADE_MAP_2:true}});
            m.setProperty('lineWidth',1.2);m.setProperty('baseColor',new cc.Color(40,42,35),0);
            m.setProperty('mainColor',cc.Color.WHITE);m.setProperty('mainTexture',await load(textureId));m.setProperty('shadeColor1',new cc.Color(205,205,205));m.setProperty('shadeColor2',new cc.Color(150,150,150));
            m.setProperty('baseStep',.78);m.setProperty('shadeStep',.4);m.setProperty('baseFeather',.12);m.setProperty('shadeFeather',.1);
            m.setProperty('specular',new cc.Vec4(0,0,0,1));
            saved=await load(await save('db://assets/模型/Boss/屠夫/材质/'+name+'.mtl',m));materialCache.set(name,saved);
        }materials.push(saved);
    }renderer.sharedMaterials=materials;}
    const badge=root.getChildByName('血条与血量');if(badge)badge.setPosition(0,1.76,0);
    root.active=true;
    const prefab=new cc.Prefab();prefab.data=root;EditorExtends.PrefabUtils.addPrefabInfo(root,root,prefab);
    const uuid=await save('db://assets/预制体/屠夫Boss.prefab',prefab);
    return {uuid,clips:report,renderers:meshes.length,materials:materialCache.size};
}finally{root.destroy();}
`;
const result=await editorCall('execute_javascript',{context:'scene',code},60000);
await fs.writeFile('tools/backups/boss-import/candidate.json',JSON.stringify(result.result,null,2));
console.log(JSON.stringify(result.result,null,2));
