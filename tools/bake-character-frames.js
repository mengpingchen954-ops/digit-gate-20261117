// 在 Creator 原生运行预览中离屏渲染，不保存场景，不修改原始模型。
return await (async () => {
    const cc=await System.import('cc');
    const {role, sourceUuid} = BAKE_REQUEST;
    const scene=cc.director.getScene();
    const game=scene.getComponentsInChildren(cc.js.getClassByName('数字门玩法'))[0];
    let source=role===0?game.enemyPrefab:game.soldierPrefabs[role-1];const expected=source.uuid;
    if(sourceUuid)source=await new Promise((resolve,reject)=>cc.assetManager.loadAny({uuid:sourceUuid},(e,a)=>e?reject(e):resolve(a)));
    const baked=source.data.getComponent(cc.js.getClassByName('角色序列帧'));
    if(baked)source=await new Promise((resolve,reject)=>cc.assetManager.loadAny({uuid:baked.atlasData.json.sourceUuid},(e,a)=>e?reject(e):resolve(a)));
    if(!source.data.getComponent(cc.js.getClassByName('角色动画绑定'))) throw Error('烘焙输入必须是原始 3D 预制体');
    const hidden=scene.children.filter(n=>n.active&&n.name!=='Main Light');
    hidden.forEach(n=>n.active=false);
    const root=new cc.Node('临时序列帧烘焙');scene.addChild(root);
    const model=cc.instantiate(source);model.active=true;root.addChild(model);
    model.setPosition(0,0,0);model.setScale(1,1,1);model.setRotationFromEuler(0,0,0);
    const layer=cc.Layers.Enum.DEFAULT;const visit=n=>{n.layer=layer;n.children.forEach(visit);};visit(model);
    const binder=model.getComponent(cc.js.getClassByName('角色动画绑定'));binder.autoPlay=false;
    const animation=binder.bind();animation.useBakedAnimation=true;
    animation.play(animation.clips[0].name);animation.pause();
    animation.getState(animation.clips[0].name).time=.3;animation.getState(animation.clips[0].name).sample();cc.director.getSystem('animation').blendState.apply();
    const cameraNode=new cc.Node('离屏相机');root.addChild(cameraNode);cameraNode.setRotation(game.camera.node.worldRotation);
    cameraNode.setPosition(cc.Vec3.scaleAndAdd(new cc.Vec3(),new cc.Vec3(0,1,0),cameraNode.forward,-12));
    const camera=cameraNode.addComponent(cc.Camera);camera.projection=cc.Camera.ProjectionType.ORTHO;camera.orthoHeight=1.9;
    camera.aperture=game.camera.aperture;camera.shutter=game.camera.shutter;camera.iso=game.camera.iso;
    camera.near=.01;camera.far=30;camera.visibility=layer;camera.clearFlags=cc.Camera.ClearFlag.SOLID_COLOR;camera.clearColor=new cc.Color(0,0,0,0);
    const size=124,padding=2,tile=128,directions=role===0?8:1,renderSize=256;
    const texture=new cc.RenderTexture();texture.reset({width:renderSize,height:renderSize});camera.targetTexture=texture;camera.camera.enabled=true;
    try {
        cc.director.root.frameMove(0);cc.director.root.frameMove(0);camera.camera.update(true);cc.director.root.pipeline.render([camera.camera]);
        await new Promise(r=>setTimeout(r,180));
        cc.director.root.frameMove(0);
        if(!texture.readPixels().some((v,i)=>i%4===3&&v))throw Error('批量工具初始帧已经为空');
        const actions=animation.clips.map(c=>({name:c.name,clip:c,duration:animation.getState(c.name).duration,events:c.events}));
        if(role===0&&!actions.some(a=>/Dead|Death|死亡/.test(a.name))) actions.push({name:'Death',clip:null,duration:.65,events:[]});
        let total=0;for(const a of actions){a.frames=Math.max(2,Math.ceil(a.duration*24));a.start=total;total+=a.frames*directions;}
        // 较长死亡动作使用更多列，避免图集单边超过常见手机的 4096 限制。
        const columns=total>512?32:16;
        if(total>1024)throw Error('动作图集超过 4096×4096，请拆分后再烘焙');
        const renderers=[];const collect=n=>{for(const c of n.components)if(c.model&&c.mesh)renderers.push(c);n.children.forEach(collect);};collect(model);
        const bounds={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity};
        const right=cameraNode.right,up=cameraNode.up;
        let currentClip=animation.clips[0].name;
        async function sample(a,frame,direction){
            model.setPosition(0,0,0);model.setRotationFromEuler(0,role===0?direction*45:180,0);
            const clip=a.clip??actions[0].clip;const state=animation.getState(clip.name);
            if(currentClip!==clip.name){animation.play(clip.name);animation.pause();currentClip=clip.name;}
            // 死亡动作最后一个采样点避开终点量化回绕，保持上一格已倒地姿势。
            const sampleFrame=/死亡|Dead|Death/i.test(a.name)?Math.min(frame,a.frames-2):frame;
            state.wrapMode=/死亡|Dead|Death/i.test(a.name)?cc.AnimationClip.WrapMode.Normal:cc.AnimationClip.WrapMode.Loop;
            state.time=a.clip?sampleFrame/(a.frames-1)*Math.max(0,a.duration-.0001):.15;state.sample();
            cc.director.getSystem('animation').blendState.apply();
            if(!a.clip){const elapsed=frame/(a.frames-1)*a.duration;const t=Math.max(0,Math.min(1,(elapsed-.08)/.5)),e=t*t*(3-2*t);
                const q=cc.Quat.fromEuler(new cc.Quat(),-85*e,0,-8*e);
                model.setRotation(cc.Quat.multiply(new cc.Quat(),cc.Quat.fromEuler(new cc.Quat(),0,direction*45,0),q));
                const off=cc.Vec3.transformQuat(new cc.Vec3(),new cc.Vec3(0,Math.sin(t*Math.PI)*.08,-.18*e),cc.Quat.fromEuler(new cc.Quat(),0,direction*45,0));model.setPosition(off);
            }
            camera.camera.changeTargetWindow(texture.window);
            cc.director.tick(0);camera.camera.update(true);cc.director.root.frameMove(0);
            camera.camera.scene.update(cc.director.getTotalFrames());
            for(const r of renderers){r.model.updateTransform(cc.director.getTotalFrames());r.model.updateUBOs(cc.director.getTotalFrames());}
            camera.camera.changeTargetWindow(texture.window);
            camera.camera.update(true);
            cc.director.root.pipeline.render([camera.camera]);
        }
        // 从所有动作/方向的原生包围盒测量同一画框，脚底不随帧跳动。
        for(const a of actions) for(let d=0;d<directions;d++) for(const f of [0,Math.floor(a.frames/2),a.frames-1]){
            await sample(a,f,d);
            for(const r of renderers){const b=r.model.worldBounds;
                for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){
                    const p=new cc.Vec3(b.center.x+x*b.halfExtents.x,b.center.y+y*b.halfExtents.y,b.center.z+z*b.halfExtents.z);
                    const px=cc.Vec3.dot(p,right),py=cc.Vec3.dot(p,up);
                    bounds.minX=Math.min(bounds.minX,px);bounds.maxX=Math.max(bounds.maxX,px);bounds.minY=Math.min(bounds.minY,py);bounds.maxY=Math.max(bounds.maxY,py);
                }
            }
        }
        let centerY=(bounds.minY+bounds.maxY)/2/up.y;
        let span=Math.max(Math.abs(bounds.minX)*2,Math.abs(bounds.maxX)*2,bounds.maxY-bounds.minY)*1.12;
        if(!Number.isFinite(span)||span<=0)throw Error('角色包围盒无效');
        camera.orthoHeight=span/2;cameraNode.setPosition(cc.Vec3.scaleAndAdd(new cc.Vec3(),new cc.Vec3(0,centerY,0),cameraNode.forward,-12));
        await sample(actions[0],Math.floor(actions[0].frames/2),0);
        await new Promise(r=>setTimeout(r,150));cc.director.root.frameMove(0);
        const probe=texture.readPixels();
        if(!probe.some((v,i)=>i%4===3&&v))throw Error('测量后首帧为空 '+JSON.stringify({span,centerY,renderers:renderers.length,scale:model.scale,rotation:model.eulerAngles}));
        const rows=Math.ceil(total/columns);const canvas=document.createElement('canvas');canvas.width=columns*tile;canvas.height=rows*tile;
        const ctx=canvas.getContext('2d');let emptyFrames=0;const hashes=[],raw=[];
        let left=renderSize,rightEdge=0,top=renderSize,bottom=0;
        for(const a of actions)for(let d=0;d<directions;d++)for(let f=0;f<a.frames;f++){
            await sample(a,f,d);const pixels=texture.readPixels();let opaque=0,h=2166136261;
            // 原模型是完全不透明的 Toon 多 pass，附加光照 pass 会把 alpha 写成 0。
            // 黑色透明底以外的 RGB 或已有 alpha 都属于角色，先恢复轮廓再交给 Canvas 编码。
            for(let i=0;i<pixels.length;i+=4)if(pixels[i]||pixels[i+1]||pixels[i+2]||pixels[i+3])pixels[i+3]=255;
            const flipped=new Uint8ClampedArray(pixels.length);
            for(let y=0;y<renderSize;y++)flipped.set(pixels.subarray((renderSize-y-1)*renderSize*4,(renderSize-y)*renderSize*4),y*renderSize*4);
            for(let y=0;y<renderSize;y++)for(let x=0;x<renderSize;x++)if(flipped[(y*renderSize+x)*4+3]){opaque++;left=Math.min(left,x);rightEdge=Math.max(rightEdge,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
            for(let i=0;i<pixels.length;i++)h=Math.imul(h^pixels[i],16777619);
            if(!opaque)emptyFrames++;hashes.push(h>>>0);
            raw.push(flipped);
        }
        if(emptyFrames||new Set(hashes).size<2)throw Error(`空帧=${emptyFrames}, 不重复帧=${new Set(hashes).size}, info=${JSON.stringify({position:renderers[0].node.worldPosition,rotation:model.eulerAngles,frame:renderers[0].model._jointsMedium?.animInfo?.data,cameraEnabled:camera.camera.enabled,cameraListed:cc.director.root.cameraList.includes(camera.camera),cameraWindow:camera.camera.window===texture.window})}`);
        const crop=Math.min(renderSize,Math.ceil(Math.max(2*Math.max(renderSize/2-left,rightEdge+1-renderSize/2),bottom-top+1)+6));
        const cropX=(renderSize-crop)/2,cropY=Math.max(0,Math.min(renderSize-crop,(top+bottom+1-crop)/2));
        const frameCanvas=document.createElement('canvas');frameCanvas.width=renderSize;frameCanvas.height=renderSize;
        const frameCtx=frameCanvas.getContext('2d');
        raw.forEach((pixels,index)=>{frameCtx.putImageData(new ImageData(pixels,renderSize,renderSize),0,0);ctx.drawImage(frameCanvas,cropX,cropY,crop,crop,index%columns*tile+padding,Math.floor(index/columns)*tile+padding,size,size);});
        centerY+=(.5-(cropY+crop/2)/renderSize)*span/up.y;span*=crop/renderSize;
        return {png:canvas.toDataURL('image/png'),expected,sceneUuid:scene.uuid,metadata:{version:1,sourceUuid:source.uuid,sourceName:source.name,size,padding,tile,columns,rows,directions,span,centerY,cameraPitch:game.camera.node.eulerAngles.x,actions:actions.map(({name,duration,events,start,frames})=>({name,duration,events,start,frames}))},check:{total,emptyFrames,uniqueFrames:new Set(hashes).size}};
    } finally {camera.targetTexture=null;root.destroy();texture.destroy();hidden.forEach(n=>{if(cc.isValid(n))n.active=true;});}
})();
