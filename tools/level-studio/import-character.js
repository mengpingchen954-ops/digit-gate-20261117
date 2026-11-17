// Creator 场景进程：只制作独立候选，不触碰当前关卡引用。
return await (async()=>{
    const input=IMPORT_REQUEST;
    const load=uuid=>new Promise((resolve,reject)=>cc.assetManager.loadAny({uuid},(e,a)=>e?reject(e):resolve(a)));
    const source=await load(input.model);
    // 展开导入子预制体的副本，避免序列化时只保存 FBX 链接而丢掉动画绑定。
    const sourceData=JSON.parse(EditorExtends.serialize(source));
    for(const item of sourceData){if(item?.__type__==='cc.Node')item._prefab=null;else if(item&&'__prefab' in item)item.__prefab=null;}
    const model=cc.instantiate((await EditorExtends.deserializeFull(sourceData)).data);
    model.active=false;
    const root=new cc.Node(input.name); root.active=false;root.addChild(model);
    const save=async(url,asset)=>{
        if(await Editor.Message.request('asset-db','query-uuid',url))throw Error('候选资源已存在，请重新导入');
        const result=await Editor.Message.request('asset-db','create-asset',url,EditorExtends.serialize(asset));
        await Editor.Message.request('asset-db','refresh-asset',url);return result.uuid;
    };
    try {
        const meshes=model.getComponentsInChildren(cc.SkinnedMeshRenderer);
        if(!meshes.length)throw Error('模型没有蒙皮骨骼，不能自动变成可行走丧尸。请提供带骨骼和动画的 FBX / GLB / glTF。');
        const paths=new Map();const walk=(n,p)=>{paths.set(p,n);n.children.forEach(c=>walk(c,p?p+'/'+c.name:c.name));};walk(model,'');
        const findPath=p=>{
            if(paths.has(p))return p;
            const parts=p.split('/');
            for(let i=0;i<parts.length;i++){
                const suffix=parts.slice(i).join('/');
                const matches=[...paths.keys()].filter(x=>x===suffix||x.endsWith('/'+suffix));
                if(matches.length===1)return matches[0];
            }
            throw Error('动画骨骼不匹配或重名：'+p+'。请使用与模型同骨架的动作；本工具不进行跨骨架重定向。');
        };
        // 固化原生骨架路径，兼容多个身体 / 衣服网格；不硬编码 Main 或模型名。
        for(const renderer of meshes){
            const old=renderer.skeleton;if(!old)throw Error('蒙皮网格缺少骨架');
            const roots=[...paths.values()].filter(n=>old.joints.every(p=>!p||!!n.getChildByPath(p)));
            if(roots.length!==1)throw Error('无法唯一确定蒙皮骨架根，请检查模型的骨骼层级');
            renderer.skinningRoot=roots[0];
        }
        for(const existing of model.getComponentsInChildren(cc.SkeletalAnimation)){existing.enabled=false;existing.playOnLoad=false;}
        const animation=model.getComponent(cc.SkeletalAnimation)??model.addComponent(cc.SkeletalAnimation);animation.enabled=true;animation.playOnLoad=false;animation.useBakedAnimation=true;
        const clips=[];
        for(const [action,uuid] of Object.entries(input.actions)){
            const original=await load(uuid),serialized=JSON.parse(EditorExtends.serialize(original));let bound=0;
            serialized[0]._hash=0;
            for(const item of serialized){
                if(item?.__type__==='cc.animation.ExoticNodeAnimation'){item._path=findPath(item._path);bound++;}
                if(item?.__type__==='cc.animation.HierarchyPath'){item.path=findPath(item.path);bound++;}
            }
            if(!bound)throw Error(action+' 没有可识别的骨骼动作轨道');
            const clip=cc.deserialize(serialized);clip.name=action;
            if(!(clip.duration>0))throw Error(action+' 动作时长为零');
            clip.events=action==='Attack'?[{frame:clip.duration*input.hitPercent/100,func:'attackHit',params:[]}]:[];
            clip.wrapMode=action==='Run'?cc.AnimationClip.WrapMode.Loop:cc.AnimationClip.WrapMode.Normal;
            const saved=await save(input.url+'/'+action+'.anim',clip);clips.push(await load(saved));
        }
        animation.clips=clips;animation.defaultClip=clips[0];
        // 可选底色贴图覆盖；原文件材质引用完整时无需选择。
        if(input.texture){
            const texture=await load(input.texture),material=new cc.Material();
            material.initialize({effectName:'builtin-standard',defines:{USE_ALBEDO_MAP:true}});
            material.setProperty('albedoMap',texture);material.setProperty('roughness',.8);
            const uuid=await save(input.url+'/底色材质.mtl',material),saved=await load(uuid);
            for(const renderer of meshes)for(let i=0;i<Math.max(1,renderer.sharedMaterials.length);i++)renderer.setSharedMaterial(saved,i);
        }
        model.setRotationFromEuler(0,input.yaw,0);
        const binder=root.addComponent(cc.js.getClassByName('角色动画绑定'));binder.autoPlay=false;
        model.active=true;root.active=true;
        const prefab=new cc.Prefab();prefab.data=root;EditorExtends.PrefabUtils.addPrefabInfo(root,root,prefab);
        const uuid=await save(input.prefabUrl,prefab);
        return {uuid,name:input.name,clips:clips.map(c=>({name:c.name,duration:c.duration})),meshes:meshes.length};
    } finally {root.destroy();}
})();
