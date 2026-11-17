import fs from 'node:fs/promises';
import { editorCall } from './editor-bridge-client.mjs';

const settings = JSON.parse(await fs.readFile('assets/配置/数字门配置.json', 'utf8'));
const cfg = { ...settings.rewardStone, layers: settings.rewards[0]?.layers ?? 3 };
const effect = JSON.parse(await fs.readFile('assets/材质/奖励石头.effect.meta', 'utf8')).uuid;
const scriptUuid = JSON.parse(await fs.readFile('assets/TS/DigitGateRock.ts.meta', 'utf8')).uuid;
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const hex = scriptUuid.replaceAll('-', '');
let scriptId = hex.slice(0, 5);
for (let i = 5; i < hex.length; i += 3) { const value = parseInt(hex.slice(i, i + 3), 16); scriptId += alphabet[value >> 6] + alphabet[value & 63]; }
const result = await editorCall('execute_javascript', { context: 'scene', code: `
const cfg=${JSON.stringify(cfg)};
const load=uuid=>new Promise((r,j)=>cc.assetManager.loadAny({uuid},(e,a)=>e?j(e):r(a)));
const save=async(url,asset)=>{
    if(await Editor.Message.request('asset-db','query-uuid',url))throw Error('资源已存在，避免覆盖：'+url);
    const saved=await Editor.Message.request('asset-db','create-asset',url,EditorExtends.serialize(asset));
    await Editor.Message.request('asset-db','refresh-asset',url);return saved.uuid;
};
const material=new cc.Material();material.initialize({effectAsset:await load('${effect}')});
material.setProperty('tint',new cc.Color().fromHEX(cfg.color));
const materialUuid=await Editor.Message.request('asset-db','query-uuid','db://assets/模型/奖励石头/石头纯色.mtl')||await save('db://assets/模型/奖励石头/石头纯色.mtl',material);
const savedMaterial=await load(materialUuid);
const source=await load('41e4c524-70cd-480b-b6a7-56a8df4c93df');
const serialized=JSON.parse(EditorExtends.serialize(source));
for(const item of serialized){if(item?.__type__==='cc.Node')item._prefab=null;else if(item&&'__prefab' in item)item.__prefab=null;}
const root=cc.instantiate((await EditorExtends.deserializeFull(serialized)).data);root.name='分层石头奖励';
try{
    const oldBody=root.getChildByName('桶身尺寸');oldBody?.removeFromParent();oldBody?.destroy();
    const barrel=root.components.find(c=>'planeIconMaterial' in c);const planeMaterial=barrel.planeIconMaterial;root.removeComponent(barrel);
    const stoneMesh=await load('91a4976f-22b0-4184-aaa0-96762147bed4@e10e4');
    const body=new cc.Node('石头编辑预览');root.addChild(body);body.setPosition(cfg.offset.x,cfg.offset.y,cfg.offset.z);
    for(let i=0;i<cfg.layers;i++){
        const n=new cc.Node('石头第'+(i+1)+'层');body.addChild(n);n.setPosition(0,cfg.size.y/2+i*(cfg.size.y+cfg.gap),0);
        n.setRotationFromEuler(-90,0,0);n.setScale(cfg.size.x/.02,cfg.size.z/.02,cfg.size.y/.006);
        const r=n.addComponent(cc.MeshRenderer);r.mesh=stoneMesh;r.setSharedMaterial(savedMaterial,0);
    }
    root.getChildByName('箱面数字').setPosition(cfg.offset.x,cfg.offset.y+(cfg.layers*cfg.size.y+(cfg.layers-1)*cfg.gap)/2,cfg.offset.z+cfg.size.z*(1+cfg.hitScale)/2+.06);
    root.getChildByName('奖励图标').setPosition(cfg.offset.x,cfg.offset.y+cfg.layers*cfg.size.y+(cfg.layers-1)*cfg.gap+.65,cfg.offset.z);
    const prefab=new cc.Prefab();prefab.data=root;EditorExtends.PrefabUtils.addPrefabInfo(root,root,prefab);
    const data=JSON.parse(EditorExtends.serialize(prefab));
    const rootId=data[0].data.__id__,compId=data.length;
    data[rootId]._components.push({__id__:compId});
    data.push({__type__:'${scriptId}',_name:'',_objFlags:0,__editorExtras__:{},node:{__id__:rootId},_enabled:true,__prefab:null,
        stoneMesh:{__uuid__:stoneMesh.uuid,__expectedType__:'cc.Mesh'},stoneMaterial:{__uuid__:materialUuid,__expectedType__:'cc.Material'},
        planeIconMaterial:{__uuid__:planeMaterial.uuid,__expectedType__:'cc.Material'},_id:''});
    const url='db://assets/预制体/分层石头奖励.prefab';
    if(await Editor.Message.request('asset-db','query-uuid',url))throw Error('候选已存在');
    const saved=await Editor.Message.request('asset-db','create-asset',url,JSON.stringify(data,null,2));
    return {uuid:saved.uuid,material:materialUuid};
}finally{root.destroy();}
` }, 45000);
console.log(JSON.stringify(result, null, 2));
const uuid = result.result.uuid;
const sceneFile = 'assets/Map/scene-1.scene';
const source = await fs.readFile(sceneFile, 'utf8');
const data = JSON.parse(source);
const game = data.find(item => item.rewardBoxPrefab);
if (game.rewardBoxPrefab.__uuid__ !== '41e4c524-70cd-480b-b6a7-56a8df4c93df') throw Error('场景奖励引用已更改，请检查后再绑定');
const backup = 'tools/level-studio/data/backups/scene-before-stone-' + Date.now() + '.scene';
await fs.copyFile(sceneFile, backup);
game.rewardBoxPrefab.__uuid__ = uuid;
await fs.writeFile(sceneFile, JSON.stringify(data, null, 2) + '\n');
await editorCall('execute_javascript', { context: 'editor', code: "await Editor.Message.request('asset-db','refresh-asset','db://assets/Map/scene-1.scene');return true;" });
console.log('Bound stone prefab; scene backup: ' + backup);
