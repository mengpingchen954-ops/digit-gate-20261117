import fs from 'node:fs/promises';
import path from 'node:path';
import { editorCall } from './editor-bridge-client.mjs';
const candidate=JSON.parse(await fs.readFile('tools/backups/boss-import/candidate.json','utf8'));
const out=process.env.DIGIT_GATE_BOSS_CAPTURE;
const id=await editorCall('execute_javascript',{context:'editor',code:`const a=await Editor.Message.request('preview','query-preview-url'),url=new URL(typeof a==='string'?a:a.url);url.hostname='127.0.0.1';const w=new(require('electron').BrowserWindow)({show:false,width:750,height:1334,webPreferences:{offscreen:true,backgroundThrottling:false}});w.bossLogs=[];w.webContents.on('console-message',(_e,l,m)=>{if(l>=2)w.bossLogs.push(m);});try{await w.loadURL(url.href);return w.id;}catch(e){w.destroy();throw e;}`});
const evaluate=code=>editorCall('execute_javascript',{context:'editor',code:`const w=require('electron').BrowserWindow.fromId(${id});try{return await w.webContents.executeJavaScript(${JSON.stringify(`(async()=>{${code}})()`)});}catch(e){throw Error(e.message+' '+w.bossLogs.slice(-6).join(' | '));}`},45000);
async function capture(name){if(!out)return;await fs.mkdir(out,{recursive:true});await evaluate('cc.game.step();cc.game.pause();return true;');const b=await editorCall('execute_javascript',{context:'editor',code:`return(await require('electron').BrowserWindow.fromId(${id}).webContents.capturePage()).toPNG().toString('base64');`});await fs.writeFile(path.join(out,name+'.png'),Buffer.from(b,'base64'));}
try{
    const ready=(await fs.readFile('tools/prepare-bake-preview.js','utf8')).replace('EXPECTED_SCENE',JSON.stringify('e26a1c6f-fd17-4e70-85c0-1a6dd541906c'));await evaluate(ready);
    console.log(JSON.stringify(await evaluate(`
        window.cc=await System.import('cc');window.g=cc.director.getScene().getComponentInChildren(cc.js.getClassByName('数字门玩法'));cc.game.pause();g.music.stop();g.sound=()=>{};g.cfg=structuredClone(g.cfg);
        if(g.bossPrefabs.length!==2||g.bossPrefabs.some(p=>p.uuid!=='${candidate.uuid}'))throw Error('主场景未绑定新 Boss');
        if(g.enemies.filter(a=>a.boss).length!==g.cfg.bosses.length||g.enemies.filter(a=>a.boss).some(a=>!a.model.getChildByName('屠夫模型与动画')))throw Error('实际关卡 Boss 未全部替换');
        window.waveScale=g.cfg.bosses[0].scale;g.cfg.enemyArea.count=0;g.cfg.bosses=[];g.restart();g.actorPool.delete('boss1');g.actorPool.delete('boss2');
        g.gates.forEach(v=>v.node.active=false);g.rewards.forEach(v=>v.node.active=false);
        g.spawnBoss({startZ:5,hp:500,speed:1,style:1,scale:waveScale});window.actor=g.enemies.find(v=>v.boss);
        cc.profiler.hideStats();window.sample=(name,t)=>{actor.resume();actor.animation.play(name);const state=actor.animation.getState(name);state.setTime(t);state.sample();actor.pause();};
        sample('Move',.4);return {clips:actor.animation.clips.map(c=>({name:c.name,duration:c.duration,events:c.events})),meshes:actor.model.getComponentsInChildren(cc.SkinnedMeshRenderer).map(r=>({name:r.node.name,materials:r.sharedMaterials.map(m=>m.name),joints:r.skeleton.joints.length,primitives:r.mesh.struct.primitives.length}))};`),null,2));
    await capture('boss-walk');
    for(const [name,time] of [['Move',.9],['Attack',.4],['Attack',.85],['Dead',.9],['Dead',2.3]]){await evaluate(`sample('${name}',${time});return true;`);await capture(name+'-'+time);}
    console.log(JSON.stringify(await evaluate(`
        const passed=[],check=(ok,msg)=>{if(!ok)throw Error(msg);passed.push(msg);};
        check(actor.animation.clips.map(c=>c.name).join(',')==='Move,Attack,Dead','行走、攻击和死亡绑定正确');
        check(actor.animation.clips.find(c=>c.name==='Move').wrapMode===cc.AnimationClip.WrapMode.Loop,'行走循环播放');
        check(actor.animation.clips.find(c=>c.name==='Dead').wrapMode===cc.AnimationClip.WrapMode.Normal,'死亡只播放一次');
        check(actor.model.getComponentsInChildren(cc.SkinnedMeshRenderer).length===2,'只有身体和武器网格，没有辅助圆柱或地面');
        check(actor.model.getChildByName('屠夫模型与动画').scale.x===1.15&&actor.modelScale===waveScale,'使用校准后的模型大小并保留原关卡缩放');
        check(actor.model.getComponentsInChildren(cc.SkinnedMeshRenderer).every(r=>!!r.sharedMaterials[0].getProperty('mainTexture')),'身体和刀均使用压缩贴图');
        let hits=0;actor.reset();actor.boss=true;actor.startAttack(2,()=>hits++);actor.resume();
        const state=actor.animation.getState('Attack');for(let i=0;i<45;i++)cc.director.getSystem('animation').update(1/30);
        check(hits===1,'攻击动画只触发一次实际命中 '+JSON.stringify({hits,time:state.time,attacking:actor.attacking}));
        actor.kill();check(actor.dead&&actor.animation.getState('Dead').isPlaying,'死亡会播放新的死亡动画');
        return {passed};`),null,2));
    const logs=await editorCall('execute_javascript',{context:'editor',code:`return require('electron').BrowserWindow.fromId(${id}).bossLogs;`});
    console.log('preview logs',JSON.stringify(logs));
}finally{await editorCall('execute_javascript',{context:'editor',code:`require('electron').BrowserWindow.fromId(${id})?.destroy();return true;`});}
