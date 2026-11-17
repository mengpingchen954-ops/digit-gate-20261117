import fs from 'node:fs/promises';
import path from 'node:path';
import { editorCall } from './editor-bridge-client.mjs';

await editorCall('execute_javascript',{context:'editor',code:`
for(const url of ['db://assets/TS/DigitGateCoinBuild.ts','db://assets/TS/DigitGateGame.ts','db://assets/配置/数字门配置.json'])
    await Editor.Message.request('asset-db','refresh-asset',url);return true;`});
const built=process.argv.includes('--built');
const id=await editorCall('execute_javascript',{context:'editor',code:`
const address=await Editor.Message.request('preview','query-preview-url'),url=new URL(typeof address==='string'?address:address.url);url.hostname='127.0.0.1';
const win=new (require('electron').BrowserWindow)({show:false,width:750,height:1334,webPreferences:{offscreen:true,backgroundThrottling:false}});
win.testLogs=[];win.webContents.on('console-message',(_e,l,m)=>{if(l>=2)win.testLogs.push(m);});
try{${built?`await win.loadFile(${JSON.stringify(path.resolve('试玩成品/Google/测试.html'))});`:'await win.loadURL(url.href);'}return win.id;}catch(e){win.destroy();throw e;}`});
const evaluate=code=>editorCall('execute_javascript',{context:'editor',code:`
const win=require('electron').BrowserWindow.fromId(${id});
try{return await win.webContents.executeJavaScript(${JSON.stringify(`(async()=>{${code}})()`)});}
catch(e){throw Error(e.message+' '+win.testLogs.slice(-8).join(' | '));}`},60000);
try{
    await evaluate((await fs.readFile('tools/prepare-bake-preview.js','utf8')).replace('EXPECTED_SCENE',JSON.stringify('e26a1c6f-fd17-4e70-85c0-1a6dd541906c')));
    const result=await evaluate(`
const cc=await System.import('cc'),g=cc.director.getScene().getComponentInChildren(cc.js.getClassByName('数字门玩法')),b=g.coinBuild;
cc.game.pause();g.music.stop();g.sound=()=>{};g.begin();
// 独立检查经济和容量流程，防止敌人战斗或自动射击干扰击破次数。
g.updateEnemies=()=>{};g.updateShooting=()=>{};
const passed=[],assert=(condition,label)=>{if(!condition)throw Error(label+' '+JSON.stringify(g.getSnapshot()));passed.push(label);};
const step=n=>{for(let i=0;i<n;i++)g.update(.05);};
const move=x=>{g.targetX=g.controlX=g.squadX=x;g.squad.setPosition(x,0,g.cfg.playerZ);};
assert(g.getSnapshot().maxSoldiers===6,'初始最大队伍容量为6');
assert(b.host.settings.pickupRadius===1.65,'使用实际拾币配置，测试不扩大半径');
for(let index=0;index<2;index++){
    move(-2.94975);step(30);
    const cost=b.snapshot().cost,expected=6+(index+1)*2;
    assert(b.snapshot().obstacleReady,'金币障碍已升起 '+(index+1));
    const count=g.getSnapshot().soldiers;
    b.damageObstacle(b.snapshot().obstacleHp);
    assert(g.getSnapshot().soldiers===count,'击破只增加容量，不凭空生成士兵');
    assert(g.getSnapshot().maxSoldiers===expected,'第'+(index+1)+'次击破后容量为'+expected);
    assert(b.snapshot().groundValue===cost,'第'+(index+1)+'次掉落等于对应建造费 '+cost);
    b.damageObstacle(999999);
    assert(g.getSnapshot().maxSoldiers===expected,'同一障碍不能重复增加容量');
    step(30);move(b.host.obstacleX);step(20);
    assert(b.snapshot().coins===0&&b.snapshot().wallet===cost,'右路中央吸收全部'+cost+'金币，无地面残留');
    move(0);
    const beforeBuilt=b.snapshot().stats.built;
    let depositSeconds=0;
    while(b.snapshot().stats.built===beforeBuilt&&depositSeconds<4){step(1);depositSeconds+=.05;}
    assert(depositSeconds<=cost/125+.3,'投币'+cost+'金币按加快后的速度完成');
    step(10);
    assert(b.snapshot().stats.built===index+1&&b.snapshot().wallet===0&&b.snapshot().paid===0&&b.snapshot().inFlight===0,'第'+(index+1)+'次投币刚好建造，无余额或缺口');
    assert(b.snapshot().defenses.every(d=>d.z<g.cfg.coinBuild.padZ),'生成的炮塔均位于投币UI前方');
    if(index===0)assert(Math.abs(b.snapshot().defenses[0].x)<1e-6,'只有一座炮塔时位于中路中心');
    assert(Math.abs(b.snapshot().defenses[0].z-(g.cfg.coinBuild.padZ-1.3))<1e-6,'首座炮塔紧邻投币UI前方1.3米');
}
const pair=b.snapshot().defenses;
assert(Math.abs(pair[0].z-pair[1].z)<1e-6&&Math.abs(Math.abs(pair[0].x-pair[1].x)-1.5)<1e-6&&Math.abs(pair[0].x+pair[1].x)<1e-6,'第一座存活时，第二座在旁边，两座居中并排');
const tank=b.liveDefenses.find(d=>d.type===1),renderers=tank.node.getComponentsInChildren(cc.MeshRenderer);
assert(renderers.length>0&&renderers.every(r=>{const m=r.getSharedMaterial(0),t=m.getProperty('albedoMap'),c=m.getProperty('mainColor');return t?._uuid==='eec1789f-e748-40b8-b8b2-a503cfbb0743@6c48a'&&c.r===255&&c.g===255&&c.b===255;}),'坦克各部件使用黄色原始贴图且无额外染色');
b.destroyDefense(b.liveDefenses.find(d=>d.type===0));
assert(b.liveDefenses.length===1&&Math.abs(b.liveDefenses[0].node.position.x)<1e-6,'一座被摧毁后，存活炮塔回到中路中心');
b.buildDefense();
const replacement=b.snapshot().defenses;
assert(replacement.length===2&&Math.abs(replacement[0].z-replacement[1].z)<1e-6&&Math.abs(Math.abs(replacement[0].x-replacement[1].x)-1.5)<1e-6,'补建炮塔继续在存活炮塔旁边');
move(-2.94975);
for(let i=0;i<12;i++){g.spawnGate(g.cfg.playerZ,-1);g.updateGateLane(0,-1);}
assert(g.getSnapshot().soldiers===10,'左侧数字门可补员至扩容后的10人上限');
g.restart();assert(g.getSnapshot().maxSoldiers===6&&b.snapshot().wallet===0,'重新开始恢复6人容量并清空金币');
return {passed,snapshot:g.getSnapshot()};`);
    const logs=await editorCall('execute_javascript',{context:'editor',code:`return require('electron').BrowserWindow.fromId(${id}).testLogs;`});
    if(logs.length)throw Error(logs.join('\n'));
    if(process.argv.includes('--capture')){
        await evaluate(`const cc=await System.import('cc'),g=cc.director.getScene().getComponentInChildren(cc.js.getClassByName('数字门玩法')),b=g.coinBuild;
            g.enabled=false;b.buildDefense();b.buildDefense();b.liveDefenses.forEach(d=>d.age=1);b.tickDefenses(0,false);
            cc.profiler.hideStats();cc.game.step();cc.game.pause();return true;`);
        const png=await editorCall('execute_javascript',{context:'editor',code:`const win=require('electron').BrowserWindow.fromId(${id});
            await new Promise(r=>setTimeout(r,200));return (await win.webContents.capturePage()).toPNG().toString('base64');`});
        await fs.writeFile('tools/coin-reference/turret-placement.png',Buffer.from(png,'base64'));
    }
    await fs.writeFile('tools/coin-reference/capacity-checks.json',JSON.stringify({passed:result.passed,logs},null,2));
    console.log(JSON.stringify({passed:result.passed,logs},null,2));
}finally{await editorCall('execute_javascript',{context:'editor',code:`require('electron').BrowserWindow.fromId(${id})?.destroy();return true;`});}
