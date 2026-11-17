import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { editorCall } from './editor.mjs';

const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..');
const records=path.join(here,'data/model-imports');
const extensions=new Set(['.fbx','.glb','.gltf','.bin','.png','.jpg','.jpeg','.webp','.tga','.bmp','.anim']);
let job=null,working=false;
// 刷新页面或重启工作台仍能看到最近一次结果；中断任务不自动重跑。
try {
    const names=(await fs.readdir(records)).filter(n=>/^[a-z0-9_]+\.json$/.test(n)).sort();
    if(names.length){job=JSON.parse(await fs.readFile(path.join(records,names.at(-1)),'utf8'));if(!['ready','done','restored','error'].includes(job.state)){job.state='error';job.message='上次任务被中断，请重新选择文件。旧资源和备份保留。';}}
}catch(e){if(e.code!=='ENOENT')throw e;}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const exec=async(context,code)=>{
    const value=await editorCall('execute_javascript',{context,safety_checks:false,code},60000);
    return context==='scene'?value.result:value;
};
export const modelImportBusy=()=>working;
const persist=async()=>{await fs.mkdir(records,{recursive:true});await fs.writeFile(path.join(records,job.id+'.json'),JSON.stringify(job,null,2));};
async function phase(state,message){job.state=state;job.message=message;await persist();}
function launch(fn){working=true;void fn().catch(async e=>{job.error=e.message;await phase('error','操作未完成：'+e.message);}).finally(()=>{working=false;});}
export function safeModelPath(value){
    const parts=String(value).replaceAll('\\','/').split('/');
    if(parts.some(p=>!p||p==='.'||p==='..'||/[<>:"|?*\x00-\x1f]/.test(p)||/[ .]$/.test(p)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p)))throw Error('文件路径无效');
    if(!extensions.has(path.extname(value).toLowerCase()))throw Error('不支持的文件：'+value+'。支持 FBX、GLB、glTF、配套 BIN、动画和图片，不接收脚本或压缩包。');
    return parts.join('/');
}
async function guardScene(expected){
    return exec('scene',`return await (async()=>{
        if(await Editor.Message.request('scene','query-dirty'))throw Error('Creator 有未保存修改，请先保存再操作');
        const s=cc.director.getScene(),g=s.getComponentInChildren(cc.js.getClassByName('数字门玩法'));
        if(!g){if(${JSON.stringify(!!expected)})throw Error('当前不在原游戏关卡，请重新识别模型');return null;}
        const result={sceneUuid:s.uuid,enemyUuid:g.enemyPrefab.uuid};
        const expected=${JSON.stringify(expected??null)};
        if(expected&&(expected.sceneUuid!==s.uuid||expected.enemyUuid!==g.enemyPrefab.uuid))throw Error('关卡或丧尸引用已改变，请重新识别模型');
        return result;
    })();`);
}
async function ensureScene(){
    let scene=await guardScene();if(scene)return scene;
    await exec('editor',"return await Editor.Message.request('asset-db','open-asset','e26a1c6f-fd17-4e70-85c0-1a6dd541906c');");
    for(let i=0;i<30;i++){await delay(300);scene=await guardScene();if(scene)return scene;}
    throw Error('主关卡未打开，请在 Creator 打开 scene-1');
}
async function scan(){
    job.scene=await ensureScene();
    await phase('importing','正在让 Creator 导入模型、动画和贴图…');
    await exec('editor',`return await Editor.Message.request('asset-db','refresh-asset',${JSON.stringify(job.assetUrl)});`);
    const models=[],clips=[],textures=[];
    for(const f of job.files){
        const metaFile=path.join(root,job.assetPath,f.name)+'.meta';let meta;
        for(let i=0;i<80;i++){
            try{meta=JSON.parse(await fs.readFile(metaFile,'utf8'));if(meta.imported)break;}catch{}
            await delay(250);
        }
        if(!meta?.imported)throw Error('Creator 未完成导入：'+f.name+'。检查文件是否损坏、glTF 配套文件是否齐全。');
        const sub=Object.values(meta.subMetas??{});
        const hasMesh=sub.some(s=>s.importer==='gltf-mesh');
        for(const s of sub){
            const item={uuid:s.uuid,name:f.name+' / '+s.name};
            if(s.importer==='gltf-scene'&&hasMesh)models.push(item);
            if(s.importer==='gltf-animation')clips.push(item);
            if(s.importer==='texture')textures.push(item);
        }
        if(path.extname(f.name).toLowerCase()==='.anim')clips.push({uuid:meta.uuid,name:f.name});
    }
    if(!models.length)throw Error('未找到模型网格。请同时选择模型 FBX / GLB / glTF，而不只是动画文件。');
    const choose=regex=>{const hits=clips.filter(x=>regex.test(x.name));return hits.length===1?hits[0].uuid:'';};
    const colorTextures=textures.filter(x=>/(_c[.\/]|base.?color|albedo|diffuse|底色)/i.test(x.name));
    job.catalog={models,clips,textures};
    const soleColor=textures.length===1&&!/normal|roughness|metallic|[_-]n\./i.test(textures[0].name)?textures[0].uuid:'';
    job.selection={model:models.length===1?models[0].uuid:'',actions:{Run:choose(/run|walk|move|行走|跑|走路/i),Attack:choose(/attack|攻击|扑击/i),Death:choose(/death|dead|die|死亡/i)},texture:colorTextures.length===1?colorTextures[0].uuid:soleColor,hitPercent:45,yaw:0};
    await phase('ready','识别完成。检查下方模型和三个动作，然后点击“生成并替换丧尸”。');
}
function validateSelection(input){
    const has=(list,id)=>list.some(x=>x.uuid===id);
    if(!has(job.catalog.models,input.model))throw Error('请选择导入的身体模型');
    for(const key of ['Run','Attack','Death'])if(!has(job.catalog.clips,input.actions?.[key]))throw Error('请为行走、攻击和死亡各选择一个动作，缺少的动作须补充导入');
    if(new Set(Object.values(input.actions)).size!==3)throw Error('行走、攻击、死亡不能选择同一片段');
    if(input.texture&&!has(job.catalog.textures,input.texture))throw Error('底色贴图无效');
    if(!Number.isFinite(input.hitPercent)||input.hitPercent<1||input.hitPercent>99)throw Error('攻击命中位置须为 1～99%');
    if(!Number.isFinite(input.yaw)||input.yaw< -180||input.yaw>180)throw Error('模型朝向须为 -180～180 度');
    return {model:input.model,actions:Object.fromEntries(['Run','Attack','Death'].map(k=>[k,input.actions[k]])),texture:input.texture||'',hitPercent:input.hitPercent,yaw:input.yaw};
}
async function generate(selection){
    await guardScene(job.scene);job.selection=selection;
    const modelName=path.parse(job.catalog.models.find(x=>x.uuid===selection.model).name.split(' / ')[0]).name.slice(0,40);
    const name=modelName+'_丧尸_'+job.id,assetPath=job.assetPath+'/生成动作';
    await fs.mkdir(path.join(root,assetPath),{recursive:true});
    await fs.mkdir(path.join(root,'assets/预制体/制作源资源'),{recursive:true});
    await exec('editor',`return await Editor.Message.request('asset-db','refresh-asset','db://assets');`);
    await phase('binding','正在绑定骨骼、三个动作和攻击命中帧…');
    const code=(await fs.readFile(path.join(here,'import-character.js'),'utf8')).replace('IMPORT_REQUEST',JSON.stringify({...selection,name,url:'db://'+assetPath,prefabUrl:'db://assets/预制体/制作源资源/'+name+'.prefab'}));
    job.source=await exec('scene',code);
    await phase('baking','正在生成八方向序列帧，请勿切换 Creator 场景…');
    let output='';
    await new Promise((resolve,reject)=>{
        const child=spawn(process.execPath,['tools/bake-character-frames.mjs','0'],{cwd:root,windowsHide:true,env:{...process.env,STUDIO_CANDIDATE_UUID:job.source.uuid,STUDIO_SCENE_UUID:job.scene.sceneUuid}});
        child.stdout.on('data',d=>{output+=d;});child.stderr.on('data',d=>{output+=d;});
        child.once('error',reject);child.once('exit',code=>{
            if(code===0)return resolve();
            job.diagnostic=output.slice(-6000);
            const match=output.match(/"summary":("(?:[^"\\]|\\.)*")/);
            reject(Error('生成失败，旧丧尸未替换。'+(match?JSON.parse(match[1]):'请检查 Creator 的模型导入或渲染错误；详细日志已保存在导入记录中。')));
        });
    });
    const line=output.split(/\r?\n/).find(s=>s.startsWith('STUDIO_RESULT='));if(!line)throw Error('未收到序列帧生成结果');
    const result=JSON.parse(line.slice(14));job.candidate=result.outputs[0];
    await phase('committing','正在保留血条并保存新的丧尸引用…');
    await guardScene(job.scene);
    const sceneUrl=await exec('editor',`return await Editor.Message.request('asset-db','query-url',${JSON.stringify(job.scene.sceneUuid)});`);
    if(!sceneUrl?.startsWith('db://assets/')||!sceneUrl.endsWith('.scene'))throw Error('关卡路径无效');
    job.backup='tools/level-studio/data/model-imports/'+job.id+'.scene.bak';
    await fs.copyFile(path.join(root,sceneUrl.slice(5)),path.join(root,job.backup));
    const configFile=path.join(root,'assets/配置/数字门配置.json'),previousConfig=await fs.readFile(configFile,'utf8');
    const config=JSON.parse(previousConfig);let replacementConfig=null;
    if(config.death.enemy.clip&&!['Run','Attack','Death'].includes(config.death.enemy.clip)){
        job.previousDeathClip=config.death.enemy.clip;config.death.enemy.clip='';replacementConfig=JSON.stringify(config,null,2)+'\n';
        await fs.writeFile(path.join(records,job.id+'.config.bak'),previousConfig);
        await fs.writeFile(configFile,replacementConfig);
    }
    try { await exec('scene',`return await (async()=>{
        const input=${JSON.stringify({scene:job.scene,candidate:job.candidate})},s=cc.director.getScene(),g=s.getComponentInChildren(cc.js.getClassByName('数字门玩法'));
        if(s.uuid!==input.scene.sceneUuid||g.enemyPrefab.uuid!==input.scene.enemyUuid||await Editor.Message.request('scene','query-dirty'))throw Error('场景已经变化，保留现有角色');
        const load=uuid=>new Promise((r,j)=>cc.assetManager.loadAny({uuid},(e,a)=>e?j(e):r(a)));
        const unpack=async prefab=>{
            const data=JSON.parse(EditorExtends.serialize(prefab));
            for(const item of data){if(item?.__type__==='cc.Node')item._prefab=null;else if(item&&'__prefab' in item)item.__prefab=null;}
            return (await EditorExtends.deserializeFull(data)).data;
        };
        const prefab=await load(input.candidate.uuid),old=g.enemyPrefab,root=await unpack(prefab),oldCopy=await unpack(old);
        try{
            const bar=oldCopy.getChildByName('血条与血量');if(!bar)throw Error('原丧尸缺少血条节点，请先修复预制体');
            bar.setParent(root);
            const Health=cc.js.getClassByName('角色圆角血条'),original=old.data.getComponent(Health),health=root.addComponent(Health);
            for(const key of ['backgroundColor','fillColor','padding'])if(original&&key in original)health[key]=original[key];
            const shadow=root.getChildByName('脚底阴影'),oldShadow=old.data.getChildByName('脚底阴影');if(shadow&&oldShadow)shadow.setScale(oldShadow.scale);
            const asset=new cc.Prefab();asset.data=root;EditorExtends.PrefabUtils.addPrefabInfo(root,root,asset);
            await Editor.Message.request('asset-db','save-asset',input.candidate.url,EditorExtends.serialize(asset));
            await Editor.Message.request('asset-db','refresh-asset',input.candidate.url);
            cc.assetManager.releaseAsset(prefab);const updated=await load(input.candidate.uuid);
            if(!updated.data.getChildByName('序列帧画面')?.getComponent(cc.MeshRenderer)||!updated.data.getChildByName('血条与血量')?.getComponentInChildren(cc.Graphics))throw Error('新预制体结构校验失败，未替换旧角色');
            if(cc.director.getScene()!==s||g.enemyPrefab!==old||await Editor.Message.request('scene','query-dirty'))throw Error('场景已经变化，未替换');
            g.enemyPrefab=updated;
            try{await Editor.Message.request('scene','save-scene');}catch(e){g.enemyPrefab=old;throw e;}
        }finally{root.destroy();oldCopy.destroy();}
        return true;
    })();`); } catch(e) {
        if(replacementConfig&&await fs.readFile(configFile,'utf8')===replacementConfig)await fs.writeFile(configFile,previousConfig);
        throw e;
    }
    if(replacementConfig){try{await exec('editor',"return await Editor.Message.request('asset-db','refresh-asset','db://assets/配置/数字门配置.json');");}catch{job.warning='角色与配置已保存，Creator 配置刷新失败，请手动刷新资源。';}}
    await phase('done','已替换普通丧尸。血条与战斗数值保留；重新运行游戏查看外观和动作。');
}

export async function modelImportRoute(req,url,readBody){
    if(req.method==='GET')return {job,working};
    if(working)throw Error('模型任务正在执行，请等待完成');
    if(url.pathname==='/api/model-import/start'){
        const input=await readBody(req);
        if(!Array.isArray(input.files)||!input.files.length||input.files.length>120)throw Error('请选择 1～120 个模型及配套文件');
        const files=input.files.map(f=>({name:safeModelPath(f.name),size:f.size}));
        if(files.some(f=>!Number.isSafeInteger(f.size)||f.size<=0||f.size>64*1024*1024)||files.reduce((s,f)=>s+f.size,0)>256*1024*1024)throw Error('单个文件最多 64 MB，一批最多 256 MB');
        if(new Set(files.map(f=>f.name.toLowerCase())).size!==files.length)throw Error('有重名文件，请使用文件夹导入以保留路径');
        const id=Date.now().toString(36)+'_'+crypto.randomBytes(3).toString('hex');
        job={id,state:'uploading',message:'正在接收文件…',files,uploaded:[],assetPath:'assets/模型/工作台导入/'+id};job.assetUrl='db://'+job.assetPath;
        await fs.mkdir(path.join(root,job.assetPath),{recursive:true});await persist();return {job};
    }
    if(!job||url.searchParams.get('id')!==job.id)throw Error('导入任务已变化，请刷新页面');
    if(url.pathname==='/api/model-import/file'){
        if(job.state!=='uploading')throw Error('当前任务不接收文件');
        const name=safeModelPath(url.searchParams.get('name')),file=job.files.find(f=>f.name===name);
        if(!file||job.uploaded.includes(name))throw Error('文件未声明或重复上传');
        working=true;
        try{
            const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>file.size)throw Error('上传超过声明大小');chunks.push(chunk);}
            if(size!==file.size)throw Error('文件上传不完整，请重新选择文件');
            const destination=path.join(root,job.assetPath,name);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,Buffer.concat(chunks),{flag:'wx'});
            job.uploaded.push(name);await persist();return {uploaded:job.uploaded.length};
        }finally{working=false;}
    }
    if(url.pathname==='/api/model-import/analyze'){
        if(job.state!=='uploading'||job.uploaded.length!==job.files.length)throw Error('请先上传全部文件');
        launch(scan);return {job};
    }
    if(url.pathname==='/api/model-import/build'){
        if(job.state!=='ready')throw Error('请先导入并识别模型');
        const selection=validateSelection(await readBody(req));launch(()=>generate(selection));return {job};
    }
    if(url.pathname==='/api/model-import/restore'){
        if(job.state!=='done')throw Error('没有可恢复的替换');
        working=true;
        try {
        await guardScene({sceneUuid:job.scene.sceneUuid,enemyUuid:job.candidate.uuid});
        await exec('scene',`return await (async()=>{const s=cc.director.getScene(),g=s.getComponentInChildren(cc.js.getClassByName('数字门玩法')),old=g.enemyPrefab;
            const p=await new Promise((r,j)=>cc.assetManager.loadAny({uuid:${JSON.stringify(job.scene.enemyUuid)}},(e,a)=>e?j(e):r(a)));
            if(s.uuid!==${JSON.stringify(job.scene.sceneUuid)}||g.enemyPrefab!==old||await Editor.Message.request('scene','query-dirty'))throw Error('场景发生变化，停止恢复');
            g.enemyPrefab=p;try{await Editor.Message.request('scene','save-scene');}catch(e){g.enemyPrefab=old;throw e;}return true;})();`);
        if(job.previousDeathClip){
            const file=path.join(root,'assets/配置/数字门配置.json'),config=JSON.parse(await fs.readFile(file,'utf8'));
            if(!config.death.enemy.clip){config.death.enemy.clip=job.previousDeathClip;await fs.writeFile(file,JSON.stringify(config,null,2)+'\n');await exec('editor',"return await Editor.Message.request('asset-db','refresh-asset','db://assets/配置/数字门配置.json');");}
        }
        await phase('restored','已恢复替换前的丧尸，其他关卡设置不变。');return {job};
        } finally {working=false;}
    }
    throw Error('未知的模型操作');
}
