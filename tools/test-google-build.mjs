import fs from 'node:fs/promises';
import path from 'node:path';
import { editorCall } from './editor-bridge-client.mjs';

const config=JSON.parse(await fs.readFile('package-build.config.json','utf8'));
const sceneData=JSON.parse(await fs.readFile('assets/Map/scene-1.scene','utf8'));
const expectedBossVolume=sceneData.find(c=>c.finalBossDeathSound)?.finalBossDeathVolume ?? 0.8;
const channel=process.argv[2]||'google';
if(!['google','applovin'].includes(channel))throw Error('无效渠道');
const output=path.resolve(config.outputs?.[channel]||config.output),html=path.join(output,config.name+'.html');
const mraidMock=`window.qaMraidListeners={};window.qaMraidState='loading';window.qaMraidVisible=false;window.qaStoreUrls=[];
window.mraid={getVersion:()=> '3.0',getState:()=>qaMraidState,isViewable:()=>qaMraidVisible,
addEventListener:(name,fn)=>{(qaMraidListeners[name]??=[]).push(fn);},removeEventListener:(name,fn)=>{qaMraidListeners[name]=(qaMraidListeners[name]||[]).filter(v=>v!==fn);},
open:url=>qaStoreUrls.push(url)};`;
const preload=path.resolve('temp/applovin-build/mraid-test-preload.cjs');
if(channel==='applovin')await fs.writeFile(preload,mraidMock);
const id=await editorCall('execute_javascript',{context:'editor',code:`
    const w=new(require('electron').BrowserWindow)({show:false,width:750,height:1334,webPreferences:{offscreen:true,backgroundThrottling:false,partition:'${channel}-build-qa-'+Date.now(),contextIsolation:false,preload:${channel==='applovin'?JSON.stringify(preload):'undefined'}}});
    w.buildErrors=[];w.webContents.on('console-message',(_e,l,m)=>{if(l>=3)w.buildErrors.push(m);});
    await w.loadFile(${JSON.stringify(html)});return w.id;`},60000);
const evaluate=code=>editorCall('execute_javascript',{context:'editor',code:`
    const w=require('electron').BrowserWindow.fromId(${id});
    try{return await w.webContents.executeJavaScript(${JSON.stringify(`(async()=>{${code}})()`)});}catch(e){throw Error(e.message+' '+w.buildErrors.join(' | '));}`},60000);
try{
    const lifecycle=[];
    if(channel==='applovin'){
        const source=await fs.readFile(html,'utf8');
        if(!source.includes('mraid.open')||source.includes('ExitApi.exit'))throw Error('AppLovin 渠道适配不正确');
        lifecycle.push(...await evaluate(`
            for(let i=0;i<400;i++){
                if(window.qaMraidListeners?.ready?.length){
                    if(window.b_start_ads)throw Error('MRAID ready 前已启动广告');
                    window.qaMraidState='default';qaMraidListeners.ready.forEach(fn=>fn());
                    if(window.b_start_ads)throw Error('广告尚未可见就启动了引擎');
                    window.qaMraidVisible=true;qaMraidListeners.viewableChange.forEach(fn=>fn(true));
                    if(!window.b_start_ads)throw Error('广告可见后未启动');
                    return ['AppLovin MRAID ready 与可见性控制正确'];
                }
                await new Promise(r=>setTimeout(r,100));
            }throw Error('未注册 AppLovin MRAID ready 事件');`));
    }
    await evaluate(`
        for(let i=0;i<400;i++){
            if(typeof System!=='undefined'){
                try{window.qaEngine=await System.import('cc');}catch{}
                const engine=window.qaEngine;
                if(engine?.game._inited){engine.game.resume();engine.game.step();}
                const type=engine?.js.getClassByName('数字门玩法');
                window.g=type&&engine.director.getScene()?.getComponentInChildren(type);
                if(g?.cfg){engine.game.pause();g.music.stop();g.sound=()=>{};return true;}
            }
            await new Promise(r=>setTimeout(r,100));
        }throw Error('构建包未能加载关卡');`);
    const result=await evaluate(`
        const cc=window.qaEngine,passed=[],check=(ok,s)=>{if(!ok)throw Error(s);passed.push(s);};
        const capacityToasts=()=>g.hud.toasts.filter(t=>t.node.getComponentInChildren(cc.Label)?.string.includes('容量'));
        check(g.cfg.maxSoldiers===4&&g.squadCapacity===4,'成品初始容量为 4');
        const bosses=g.enemies.filter(a=>a.boss);
        check(bosses.length===g.cfg.bosses.length&&bosses.every(a=>a.model.getChildByName('屠夫模型与动画')),'成品所有 Boss 均为新模型');
        check(bosses.every(a=>a.animation.clips.map(c=>c.name).join(',')==='Move,Attack,Dead'),'成品 Boss 三段动画完整');
        check(bosses.every(a=>a.model.getComponentsInChildren(cc.SkinnedMeshRenderer).every(r=>!!r.sharedMaterials[0].getProperty('mainTexture'))),'成品身体和刀贴图完整');
        check(g.rewards.every(r=>r.rock),'成品奖励使用分层石头');
        g.begin();const first=g.rewards.find(r=>r.leftBarrier);g.hitReward(g.rewards.indexOf(first),first.hp);
        check(g.squadCapacity===4,'图片抵达前不提前扩容');
        g.hud.tick(g.cfg.effects.rewardFlightSeconds+.01);
        check(g.squadCapacity===7&&capacityToasts().length===0,'成品领取奖励容量 +3 且没有扩容特效');
        const plane=g.rewards.find(r=>r.kind==='plane');g.hitReward(g.rewards.indexOf(plane),plane.hp);
        check(g.squadCapacity===10&&capacityToasts().length===0,'成品右侧奖励同样容量 +3 且没有扩容特效');
        while(g.liveSoldiers.length<g.squadCapacity)g.addSoldier();
        check(g.hud.toasts.some(t=>t.node.getComponentInChildren(cc.Label)?.string.includes('MAX')),'成品满员时仍有 MAX');
        const maxCount=()=>g.hud.toasts.filter(t=>t.node.getComponentInChildren(cc.Label)?.string.includes('MAX')).length;
        g.gates.forEach(v=>v.node.destroy());g.gates=[];
        const pass=side=>{g.squadX=g.laneX(g.cfg.playerZ,side);g.spawnGate(g.cfg.playerZ,side);g.gates.at(-1).released=true;g.updateGateLane(0,side);};
        const maxBefore=maxCount();pass(-1);
        check(maxCount()===maxBefore,'成品满员后第一扇增兵门不提示 MAX');
        pass(1);check(maxCount()===maxBefore+1,'成品满员后左右合计两扇增兵门显示一次 MAX');
        pass(-1);pass(1);check(maxCount()===maxBefore+2,'成品 MAX 持续按每两扇门重复显示');
        g.rewardIndex=4;g.spawnLeftReward(false);
        const fifth=g.rewards.at(-1),bow=g.rewardIconTextures.find(t=>t.uuid===g.cfg.rewards[4].icon);
        check(g.cfg.rewards[4].icon==='63914264-5453-4043-ab4f-deb2d727d16f@6c48a'&&!!bow&&fifth.node.getComponentInChildren(cc.Sprite).spriteFrame.texture===bow,'成品奖励 5 使用三级弓图片');
        check(g.finalBossDeathSound?.uuid==='61dde659-0b9c-49bd-b8ef-3a4a2ded4ddb'&&g.finalBossDeathVolume===${JSON.stringify(expectedBossVolume)},'成品包含爆炸音效并保留组件设置的音量');
        const audio=g.effectsAudio,play=audio.playOneShot,explosions=[];
        audio.playOneShot=function(clip,volume){if(clip===g.finalBossDeathSound)explosions.push(volume);return play.call(this,clip,volume);};
        bosses.slice(0,-1).forEach(a=>g.removeEnemy(g.enemies.indexOf(a),true));
        check(explosions.length===0,'成品前面的 Boss 不播放最终爆炸音效');
        const lastBoss=bosses.at(-1);g.removeEnemy(g.enemies.indexOf(lastBoss),true);
        check(explosions.length===1&&explosions[0]===${JSON.stringify(expectedBossVolume)},'成品最后一个 Boss 死亡按设置音量播放一次爆炸');
        g.removeEnemy(g.enemies.indexOf(lastBoss),true);
        check(explosions.length===1,'成品重复伤害不重复播放爆炸');
        audio.playOneShot=play;
        g.restart();check(g.squadCapacity===4,'成品重开恢复 4');
        if(${JSON.stringify(channel)}==='applovin'){
            g.openStore();
            check(qaStoreUrls.length===1&&qaStoreUrls[0]===g.cfg.storeUrls.android,'AppLovin 安装按钮通过 MRAID 打开配置商店地址');
        }
        cc.game.step();cc.game.pause();return {passed};`);
    result.passed.unshift(...lifecycle);
    const errors=await editorCall('execute_javascript',{context:'editor',code:`return require('electron').BrowserWindow.fromId(${id}).buildErrors;`});
    if(errors.length)throw Error(errors.join('\n'));
    const png=await editorCall('execute_javascript',{context:'editor',code:`return(await require('electron').BrowserWindow.fromId(${id}).webContents.capturePage()).toPNG().toString('base64');`});
    await fs.writeFile('temp/'+channel+'-build/成品预览.png',Buffer.from(png,'base64'));
    const reportFile=path.join(output,'构建记录.json'),report=JSON.parse(await fs.readFile(reportFile,'utf8'));
    Object.assign(report,{validation:'passed',validationChecks:result.passed,validatedAt:new Date().toISOString()});
    await fs.writeFile(reportFile,JSON.stringify(report,null,2));
    console.log(JSON.stringify({html,htmlBytes:(await fs.stat(html)).size,...result},null,2));
}finally{await editorCall('execute_javascript',{context:'editor',code:`require('electron').BrowserWindow.fromId(${id})?.destroy();return true;`});}
