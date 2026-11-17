const models=COIN_MODELS;
const save=async(url,asset)=>{
    const result=await Editor.Message.request('asset-db',await Editor.Message.request('asset-db','query-uuid',url)?'save-asset':'create-asset',url,EditorExtends.serialize(asset));
    await Editor.Message.request('asset-db','refresh-asset',url);return result;
};
const load=async uuid=>await new Promise((r,j)=>cc.assetManager.loadAny({uuid},(e,a)=>e?j(e):r(a)));
const material=async(name,rgb,metal=.3,texture=null)=>{
    const m=new cc.Material();m.name=name;m.initialize({effectName:'builtin-standard',defines:{USE_INSTANCING:true,USE_ALBEDO_MAP:!!texture}});
    m.setProperty('mainColor',new cc.Color(...rgb));m.setProperty('metallic',metal);m.setProperty('roughness',.36);
    if(name==='金币金色'){m.setProperty('emissive',new cc.Color(255,175,0));m.setProperty('emissiveScale',new cc.Vec3(.4,.4,.4));}
    if(texture)m.setProperty('albedoMap',texture);
    const result=await save('db://assets/材质/金币建造/'+name+'.mtl',m);m.destroy();return load(result.uuid);
};
const palette={
    gold:await material('金币金色',[255,205,12],.12),blue:await material('炮台亮蓝',[30,158,223]),
    navy:await material('炮台深蓝',[20,67,101]),silver:await material('炮管银白',[210,234,244],.65),
    dark:await material('炮口深色',[30,40,46],.35),
};
const clean=async uuid=>{
    const data=JSON.parse(EditorExtends.serialize(await load(uuid)));
    for(const o of data){if(o.__type__==='cc.Node')o._prefab=null;else if(o&&'__prefab'in o)o.__prefab=null;}
    const root=(await EditorExtends.deserializeFull(data)).data;
    for(const r of root.getComponentsInChildren(cc.MeshRenderer))if(r.node.name.startsWith('UCX_'))r.node.destroy();
    for(const c of root.getComponentsInChildren(cc.Animation))c.enabled=false;
    return root;
};
const prefab=async(root,name)=>{
    const asset=new cc.Prefab();asset.name=name;asset.data=root;
    EditorExtends.PrefabUtils.addPrefabInfo(root,root,asset);
    const result=await save('db://assets/预制体/'+name+'.prefab',asset);root.destroy();return load(result.uuid);
};
const coinRoot=new cc.Node('金币-校准尺寸'),coin=await clean(models.Coin);coin.parent=coinRoot;
coin.setScale(.27,.27,.27);coin.setRotationFromEuler(0,0,90);
for(const r of coin.getComponentsInChildren(cc.MeshRenderer))r.sharedMaterials=r.sharedMaterials.map(()=>palette.gold);
const coinPrefab=await prefab(coinRoot,'金币_收集建造');
const cannonRoot=new cc.Node('炮台一-三部件'),turn=new cc.Node('炮塔转向');turn.parent=cannonRoot;turn.setRotationFromEuler(0,180,0);
for(const [name,y]of [['炮_底座',0],['炮_中台2',.3],['炮_炮杆2',.44]]){
    const wrapper=new cc.Node(name);wrapper.parent=turn;wrapper.setPosition(0,y,0);wrapper.setScale(3.8,3.8,3.8);
    const n=await clean(models[name]);n.parent=wrapper;
    for(const r of n.getComponentsInChildren(cc.MeshRenderer))r.sharedMaterials=r.sharedMaterials.map(m=>{
        const name=m?.name??'';return /黑/.test(name)?palette.dark:/银/.test(name)?palette.silver:/蓝|钢铁/.test(name)?palette.blue:/金/.test(name)?palette.gold:palette.silver;
    });
}
const cannonPrefab=await prefab(cannonRoot,'炮台一_蓝色三部件');
const tankRoot=new cc.Node('炮台二-黄坦克'),tankTurn=new cc.Node('炮塔转向');tankTurn.parent=tankRoot;tankTurn.setRotationFromEuler(0,180,0);tankTurn.setScale(.62,.62,.62);
const tank=await clean(models.黄坦克);tank.parent=tankTurn;
const tankTextureId=await Editor.Message.request('asset-db','query-uuid','db://assets/模型/金币建造/TF_TankFree_Base_Color_Y.png/texture');
const tankTexture=tankTextureId?await load(tankTextureId):null;
const tankMaterials=new Map();
for(const r of tank.getComponentsInChildren(cc.MeshRenderer)){
    const out=[];
    for(const m of r.sharedMaterials){
        if(!m){out.push(palette.gold);continue;}
        if(!tankMaterials.has(m.uuid))tankMaterials.set(m.uuid,await material('黄坦克贴图材质',tankTexture?[255,255,255]:[255,214,75],.2,tankTexture??m.getProperty('albedoMap')));
        out.push(tankMaterials.get(m.uuid));
    }r.sharedMaterials=out;
}
const tankPrefab=await prefab(tankRoot,'炮台二_黄坦克');
const scene=cc.director.getScene(),g=scene.getComponentInChildren(cc.js.getClassByName('数字门玩法'));
if(!g||scene.uuid!=='e26a1c6f-fd17-4e70-85c0-1a6dd541906c')throw Error('请打开游戏主场景');
const Type=cc.js.getClassByName('金币收集与炮台建造');if(!Type)throw Error('金币脚本尚未完成编译');
const component=g.node.getComponent(Type)??g.node.addComponent(Type);
component.coinPrefab=coinPrefab;component.cannonPrefab=cannonPrefab;component.tankPrefab=tankPrefab;g.coinBuild=component;
await Editor.Message.request('scene','save-scene');
return {coin:coinPrefab.uuid,cannon:cannonPrefab.uuid,tank:tankPrefab.uuid,component:component.uuid};
