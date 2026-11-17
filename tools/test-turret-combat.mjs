import fs from 'node:fs/promises';
import path from 'node:path';
import { editorCall } from './editor-bridge-client.mjs';

await editorCall('execute_javascript',{context:'editor',code:`
for(const url of ['db://assets/TS/DigitGateGame.ts','db://assets/TS/DigitGateCoinBuild.ts'])
    await Editor.Message.request('asset-db','refresh-asset',url);return true;`});
const built=process.argv.includes('--built');
const id=await editorCall('execute_javascript',{context:'editor',code:`
const a=await Editor.Message.request('preview','query-preview-url'),url=new URL(typeof a==='string'?a:a.url);url.hostname='127.0.0.1';
const w=new(require('electron').BrowserWindow)({show:false,width:750,height:1334,webPreferences:{offscreen:true,backgroundThrottling:false}});
w.testLogs=[];w.webContents.on('console-message',(_e,l,m)=>{if(l>=2)w.testLogs.push(m);});
try{${built?`await w.loadFile(${JSON.stringify(path.resolve('试玩成品/Google/测试.html'))});`:'await w.loadURL(url.href);'}return w.id;}catch(e){w.destroy();throw e;}`});
const evaluate=code=>editorCall('execute_javascript',{context:'editor',code:`
const w=require('electron').BrowserWindow.fromId(${id});
try{return await w.webContents.executeJavaScript(${JSON.stringify('(async()=>{'+code+'})()')});}
catch(e){throw Error(e.message+' '+w.testLogs.slice(-8).join(' | '));}`},60000);
try{
    await evaluate((await fs.readFile('tools/prepare-bake-preview.js','utf8')).replace('EXPECTED_SCENE',JSON.stringify('e26a1c6f-fd17-4e70-85c0-1a6dd541906c')));
    const result=await evaluate(`
window.cc=await System.import('cc');window.g=cc.director.getScene().getComponentInChildren(cc.js.getClassByName('数字门玩法'));window.b=g.coinBuild;
cc.game.pause();g.music.stop();g.sound=()=>{};g.begin();
window.boss=g.enemies.find(a=>a.boss);
const passed=[],assert=(ok,label)=>{if(!ok)throw Error(label);passed.push(label);};
const waves=g.enemies.filter(a=>a.boss);
assert(waves.length===2&&waves[0].maxHp===240&&waves[1].maxHp===800,'全流程仅两只Boss，血量为240和800');
assert(g.bossPrefabs[0].uuid==='0880d8b6-72e9-4aee-8082-c204a6c67012'&&waves[0].model.name==='Boss1','首只Boss使用工程中的Boss1预制体 '+JSON.stringify({prefab:g.bossPrefabs[0].uuid,model:waves[0].model.name}));
assert(waves[1].model.name==='屠夫Boss'&&waves[1].finalBoss,'第二只保留屠夫形象并作为最终Boss');
const gold=b.coinPrefab.data.getComponentInChildren(cc.MeshRenderer).getSharedMaterial(0);
assert(gold.getProperty('mainColor').g===205&&gold.getProperty('metallic')===.12&&gold.getProperty('emissiveScale').x===.4,'金币使用鲜亮金色、低金属度和暖色自发光');
g.enemies=[boss];
// 目标不移动、不旋转；从不同角度接近，覆盖原来卡在浮点边界的偏移 ±.12、±.2。
for(const kind of ['cannon','tank','player']){
    b.reset();
    if(kind!=='player'){b.buildDefense();if(kind==='tank'){b.destroyDefense(b.liveDefenses[0]);b.buildDefense();}}
    const target=kind==='player'?g.soldiers[0].node.worldPosition.clone():b.liveDefenses[0].node.position.clone();
    for(let j=0;j<=100;j++){
        boss.reset();boss.boss=true;boss.speed=1.3;boss.chasing=true;
        boss.node.setPosition(target.x-2+j*.04,.04,target.z-3.8);
        for(let i=0;i<250&&!boss.attacking;i++)g.updateEnemies(.05);
        if(!boss.attacking)throw Error('静止目标接近后未攻击 '+kind+' offset '+(-2+j*.04));
    }
    assert(true,'Boss 从101个角度接近静止 '+kind+' 均主动攻击');
    // 使用真正 Attack 动画事件，而非直接调用伤害函数。
    boss.reset();boss.boss=true;boss.speed=1.3;boss.chasing=true;boss.resume();
    const range=g.cfg.bossCombat.attackDistance+(kind==='player'?0:.45);
    boss.node.setPosition(target.x,.04,target.z-range-.3);
    for(let i=0;i<100&&!boss.attacking;i++)g.updateEnemies(.05);
    assert(boss.attacking,'静止 '+kind+' 前开始播放攻击');
    for(let i=0;i<60;i++)cc.director.getSystem('animation').update(1/30);
    assert(kind==='player'?g.liveSoldiers.length===0:b.liveDefenses.length===0,'真实攻击命中帧对静止 '+kind+' 结算伤害');
}
g.restart();g.begin();g.enemies=[boss];boss.reset();boss.boss=true;boss.hp=boss.maxHp=10000;
boss.node.setPosition(0,.04,3.8);b.buildDefense();b.buildDefense();
const effects=[],effect=b.host.effect;b.host.effect=(p,c,s,strength,duration)=>{effects.push({x:p.x,z:p.z,scale:s,strength,duration});effect(p,c,s,strength,duration);};
for(const defense of b.liveDefenses){defense.age=1;b.fire(defense,boss);}
assert(b.shots.length===3,'蓝炮双发与坦克单发均保留');
assert(b.shots.every(s=>s.node.children.length===3),'每枚炮弹都有弹头和两段渐缩尾光');
assert(effects.length===3&&effects.every(e=>e.scale>=.65),'两种炮塔均有明显炮口闪光');
const hp=boss.hp;for(let i=0;i<20;i++)b.tickShots(.02);
assert(boss.hp<hp&&b.stats.hits===3,'三枚炮弹均通过弹道碰撞产生伤害');
assert(effects.some(e=>e.scale===1.35&&e.strength===1.7)&&effects.some(e=>Math.abs(e.scale-3.5)<1e-6&&e.duration===.5),'蓝炮命中更亮，坦克有持续半秒的大范围爆闪');
const extras=[1.5,2.3,3].map(x=>{const a=g.takeActor('enemy');a.hp=a.maxHp=1000;a.radius=.24;a.node.setPosition(x,.04,3.8);return a;});
g.enemies=[boss,...extras];boss.hp=10000;
const tank=b.liveDefenses.find(d=>d.type===1);b.fire(tank,boss);
for(let i=0;i<20;i++)b.tickShots(.02);
assert(extras[0].hp===978&&extras[1].hp===978&&extras[2].hp===1000,'坦克爆炸伤害覆盖2.1米半径内含碰撞边缘的敌人，范围外不受伤');
const cannon=b.liveDefenses.find(d=>d.type===0);b.fire(cannon,boss);
for(let i=0;i<20;i++)b.tickShots(.02);
assert(extras[0].hp===978&&extras[1].hp===978,'蓝炮保持单体双发伤害');
cannon.cooldown=100;tank.cooldown=0;
const fire=b.fire.bind(b),times=[];let clock=0;
b.fire=(d,t)=>{if(d.type===1)times.push(clock);fire(d,t);};
for(let i=0;i<60;i++){clock+=.05;b.tickDefenses(.05,true);}
b.fire=fire;
assert(times.length===3&&times.slice(1).every((t,i)=>t-times[i]>=1.19),'坦克每约1.2秒发射一次，3秒内仅发射3次');
for(const shot of b.shots)shot.node.destroy();b.shots=[];
b.host.effect=effect;
return {passed};`);
    if(process.argv.includes('--capture')){
        await evaluate(`
g.enabled=false;boss.node.setPosition(0,.04,3.8);boss.play('move');boss.pause();
for(const d of b.liveDefenses){d.age=1;d.cooldown=100;}b.tickDefenses(0,false);
b.liveDefenses.forEach(d=>b.fire(d,boss));b.tickShots(.025);
g.hitEffects.filter(e=>e.node.active).forEach(e=>e.sample(.2));
cc.profiler.hideStats();cc.game.step();cc.game.pause();return true;`);
        const png=await editorCall('execute_javascript',{context:'editor',code:`
const w=require('electron').BrowserWindow.fromId(${id});await new Promise(r=>setTimeout(r,150));return(await w.webContents.capturePage()).toPNG().toString('base64');`});
        await fs.writeFile('tools/coin-reference/turret-firing.png',Buffer.from(png,'base64'));
    }
    const logs=await editorCall('execute_javascript',{context:'editor',code:`return require('electron').BrowserWindow.fromId(${id}).testLogs;`});
    if(logs.length)throw Error(logs.join('\n'));
    await fs.writeFile('tools/coin-reference/combat-checks.json',JSON.stringify({...result,built,logs},null,2));
    console.log(JSON.stringify({...result,built,logs},null,2));
}finally{
    await editorCall('execute_javascript',{context:'editor',code:`require('electron').BrowserWindow.fromId(${id})?.destroy();return true;`});
}
