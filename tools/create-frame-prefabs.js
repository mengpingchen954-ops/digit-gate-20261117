return await (async()=>{
    const base='db://assets/角色序列帧/';
    const load=async url=>{const uuid=await Editor.Message.request('asset-db','query-uuid',url);if(!uuid)throw Error('未导入 '+url);const old=cc.assetManager.assets.get(uuid);if(old)cc.assetManager.releaseAsset(old);return await new Promise((resolve,reject)=>cc.assetManager.loadAny({uuid},(e,a)=>e?reject(e):resolve(a)));};
    const effect=await load(base+'角色序列帧.effect');
    const Frame=cc.js.getClassByName('角色序列帧');if(!Frame)throw Error('序列帧脚本尚未编译');
    const save=async(url,asset)=>{
        const result=await Editor.Message.request('asset-db',await Editor.Message.request('asset-db','query-uuid',url)?'save-asset':'create-asset',url,EditorExtends.serialize(asset));
        await Editor.Message.request('asset-db','refresh-asset',url);return result;
    };
    const shadowUrl=base+'脚底阴影.mtl';
    if(!await Editor.Message.request('asset-db','query-uuid',shadowUrl)){
        const shadow=new cc.Material();shadow.initialize({effectAsset:effect,technique:1,defines:{USE_INSTANCING:true}});shadow.name='脚底阴影';await save(shadowUrl,shadow);shadow.destroy();
    }
    const shadowMaterial=await load(shadowUrl);
    const results=[];
    for(const name of BAKED_NAMES){
        const url=base+name+'/';
        const data=await load(url+'动作数据.json');
        const texture=await load(url+'动作图集.png/texture');
        const mtl=new cc.Material();mtl.name=name+'_序列帧';
        mtl.initialize({effectAsset:effect,defines:{USE_INSTANCING:true}});
        mtl.setProperty('mainTexture',texture);mtl.setProperty('frameGeometry',new cc.Vec4(data.json.span,data.json.centerY,0,0));
        const matUrl=url+'序列帧材质.mtl';
        await save(matUrl,mtl);
        const material=await load(matUrl);
        const prefabUrl='db://assets/预制体/'+name+'_序列帧.prefab';
        const existing=await Editor.Message.request('asset-db','query-uuid',prefabUrl);
        let root;
        if(existing){
            const data=JSON.parse(EditorExtends.serialize(await load(prefabUrl)));
            for(const item of data){if(item?.__type__==='cc.Node')item._prefab=null;else if(item&&'__prefab' in item)item.__prefab=null;}
            root=(await EditorExtends.deserializeFull(data)).data;
        }else root=new cc.Node(name+'_序列帧');
        const component=root.getComponent(Frame)??root.addComponent(Frame);component.atlasData=data;
        (root.getComponent(cc.Animation)??root.addComponent(cc.Animation)).playOnLoad=false;
        let visual=root.getChildByName('序列帧画面');if(!visual){visual=new cc.Node('序列帧画面');root.addChild(visual);}
        const renderer=visual.getComponent(cc.MeshRenderer)??visual.addComponent(cc.MeshRenderer);renderer.setSharedMaterial(material,0);
        renderer.shadowCastingMode=0;renderer.shadowReceivingMode=0;
        let shadow=root.getChildByName('脚底阴影');if(!shadow){shadow=new cc.Node('脚底阴影');root.addChild(shadow);}
        shadow.setPosition(-.1,.012,-.04);shadow.setRotationFromEuler(-90,0,0);
        const width=name==='快速丧尸'?.75:name==='我方士兵_1级'?.7:1.25;shadow.setScale(width,width*.65,1);
        const sr=shadow.getComponent(cc.MeshRenderer)??shadow.addComponent(cc.MeshRenderer);sr.setSharedMaterial(shadowMaterial,0);sr.shadowCastingMode=0;sr.shadowReceivingMode=0;
        const prefab=new cc.Prefab();prefab.data=root;
        EditorExtends.PrefabUtils.addPrefabInfo(root,root,prefab);
        try{const result=await save(prefabUrl,prefab);results.push({name,url:prefabUrl,uuid:result.uuid});}
        finally{root.destroy();mtl.destroy();}
    }
    return results;
})();
