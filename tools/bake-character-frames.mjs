import fs from 'node:fs/promises';
import path from 'node:path';
import {callMcp} from './cocos-mcp.mjs';
const source=await fs.readFile(new URL('./bake-character-frames.js',import.meta.url),'utf8');
if(process.argv[2]&&!['0','1','2','3'].includes(process.argv[2]))throw Error('角色编号为 0（丧尸）或 1/2/3（士兵等级）');
const plans=[];
// 工作台先生成独立候选，全部验证成功后才提交场景引用。
const candidateUuid=process.env.STUDIO_CANDIDATE_UUID;
const candidateOnly=!!candidateUuid;
const backup='tools/backups/frame-bake-'+Date.now();await fs.mkdir(backup,{recursive:true});
// 通过 MCP 使用 Creator 自己的预览地址离屏渲染，不依赖当前编辑器面板是否处于运行模式。
const preview=await callMcp('execute_javascript',{context:'editor',code:`return await (async()=>{
    const address=await Editor.Message.request('preview','query-preview-url'),url=new URL(typeof address==='string'?address:address.url);url.hostname='127.0.0.1';
    const win=new (require('electron').BrowserWindow)({show:false,width:750,height:1334,webPreferences:{offscreen:true,backgroundThrottling:false}});
    win.studioLogs=[];win.webContents.on('console-message',(event,level,message)=>{if(level>=2)win.studioLogs.push(message);});
    try{await win.loadURL(url.href);return win.id;}catch(e){win.destroy();throw e;}
})();`});
const previewId=preview.data;
try {
const readyCode=(await fs.readFile(new URL('./prepare-bake-preview.js',import.meta.url),'utf8')).replace('EXPECTED_SCENE',JSON.stringify(process.env.STUDIO_SCENE_UUID||null));
await callMcp('execute_javascript',{context:'editor',code:`return await (async()=>{const win=require('electron').BrowserWindow.fromId(${previewId});try{return await win.webContents.executeJavaScript(${JSON.stringify(`(async()=>{${readyCode}})()`)});}catch(e){throw Error(e.message+' '+win.studioLogs.slice(-6).join(' | '));}})();`});
// 友军已恢复正常骨骼；默认只重烘焙普通丧尸，避免维护时把友军切回面片。
for(const role of (process.argv[2]?[Number(process.argv[2])]:[0])){
    const script=source.replace('BAKE_REQUEST',JSON.stringify({role,sourceUuid:candidateUuid}));
    const r=await callMcp('execute_javascript',{context:'editor',code:`return await (async()=>{const win=require('electron').BrowserWindow.fromId(${previewId});try{return await win.webContents.executeJavaScript(${JSON.stringify(`(async()=>{${script}})()`)});}catch(e){throw Error(e.message+' '+win.studioLogs.slice(-6).join(' | '));}})();`});
    const data=r.data;if(!data?.png)throw Error(JSON.stringify(r));
    if(path.basename(data.metadata.sourceName)!==data.metadata.sourceName)throw Error('角色名称不能包含路径');
    const dir='assets/角色序列帧/'+data.metadata.sourceName;await fs.mkdir(dir,{recursive:true});
    for(const name of ['动作图集.png','动作数据.json','序列帧材质.mtl',data.metadata.sourceName+'_序列帧.prefab']){
        const sourceFile=(name.endsWith('.prefab')?'assets/预制体':dir)+'/'+name;
        try{await fs.copyFile(sourceFile,backup+'/'+role+'-'+name);}catch(e){if(e.code!=='ENOENT')throw e;}
    }
    await fs.writeFile(dir+'/动作图集.png',Buffer.from(data.png.split(',')[1],'base64'));
    await fs.writeFile(dir+'/动作数据.json',JSON.stringify(data.metadata,null,2)+'\n');
    console.log(JSON.stringify({role,dir,...data.check,span:data.metadata.span,centerY:data.metadata.centerY}));
    plans.push({role,name:data.metadata.sourceName,expected:data.expected,sceneUuid:data.sceneUuid});
}
await callMcp('execute_javascript',{context:'editor',code:await fs.readFile('tools/refresh-frame-assets.js','utf8')});
const createCode=(await fs.readFile('tools/create-frame-prefabs.js','utf8')).replace('BAKED_NAMES',JSON.stringify(plans.map(p=>p.name)));
// 仅对已审阅的项目内生成器关闭路径字符串启发式检查；MCP 的工程身份核对仍开启。
const created=await callMcp('execute_javascript',{context:'scene',safety_checks:false,code:createCode});
const outputs=created.data.result;
for(const p of plans)p.uuid=outputs.find(o=>o.name===p.name).uuid;
// 重新烘焙已有序列帧时 UUID 不变，无需重存用户场景。
const changed=plans.filter(p=>p.uuid!==p.expected);
if(changed.length&&!candidateOnly){
const sceneInfo=await callMcp('execute_javascript',{context:'editor',code:`return await Editor.Message.request('asset-db','query-asset-info',${JSON.stringify(plans[0].sceneUuid)});`});
await fs.copyFile(sceneInfo.data.file,backup+'/scene.scene.bak');
await callMcp('execute_javascript',{context:'scene',code:`return await (async()=>{
    const plans=${JSON.stringify(changed)},s=cc.director.getScene();if(s.uuid!==plans[0].sceneUuid)throw Error('烘焙期间场景已切换，未更改引用');
    const g=s.getComponentsInChildren(cc.js.getClassByName('数字门玩法'))[0];
    for(const p of plans)if((p.role===0?g.enemyPrefab:g.soldierPrefabs[p.role-1]).uuid!==p.expected)throw Error('角色引用已被更改，保留新选择');
    for(const p of plans){const prefab=await new Promise((r,j)=>cc.assetManager.loadAny({uuid:p.uuid},(e,a)=>e?j(e):r(a)));if(p.role===0)g.enemyPrefab=prefab;else g.soldierPrefabs[p.role-1]=prefab;}
    await Editor.Message.request('scene','save-scene');return true;
})();`});
}
console.log('烘焙与引用更新完成。备份：'+backup);
if(candidateOnly)console.log('STUDIO_RESULT='+JSON.stringify({outputs,backup}));
} finally {
    await callMcp('execute_javascript',{context:'editor',code:`require('electron').BrowserWindow.fromId(${previewId})?.destroy();return true;`});
}
