import fs from 'node:fs/promises';
import sharp from 'sharp';
import { editorCall } from './editor-bridge-client.mjs';
const output='tools/road-preview'; await fs.mkdir(output,{recursive:true});
await editorCall('execute_javascript',{context:'editor',code:`for(const url of ['db://assets/TS/DigitGateLayout.ts','db://assets/TS/DigitGateGame.ts','db://assets/配置/数字门配置.json']) await Editor.Message.request('asset-db','refresh-asset',url); return true;`});
const id=await editorCall('execute_javascript',{context:'editor',code:`
const address=await Editor.Message.request('preview','query-preview-url'),url=new URL(typeof address==='string'?address:address.url);url.hostname='127.0.0.1';
const win=new (require('electron').BrowserWindow)({show:false,width:900,height:1200,webPreferences:{offscreen:true,backgroundThrottling:false}});
win.roadLogs=[];win.webContents.on('console-message',(_e,level,message)=>{if(level>=2)win.roadLogs.push(message);});
try {await win.loadURL(url.href);return win.id;}catch(e){win.destroy();throw e;}`});
const evaluate=code=>editorCall('execute_javascript',{context:'editor',code:`const win=require('electron').BrowserWindow.fromId(${id});try{return await win.webContents.executeJavaScript(${JSON.stringify(`(async()=>{${code}})()`)});}catch(e){throw Error(e.message+' '+win.roadLogs.slice(-6).join(' | '));}`},60000);
const capture=async name=>{
    const png=await editorCall('execute_javascript',{context:'editor',code:`return (await require('electron').BrowserWindow.fromId(${id}).webContents.capturePage()).toPNG().toString('base64');`});
    const buffer=Buffer.from(png,'base64'),metadata=await sharp(buffer).metadata();
    await sharp(buffer).extract({left:name==='overview'?260:75,top:50,width:name==='overview'?380:750,height:metadata.height-50}).png().toFile(`${output}/${name}.png`);
};
try {
    const ready=(await fs.readFile('tools/prepare-bake-preview.js','utf8')).replace('EXPECTED_SCENE',JSON.stringify('e26a1c6f-fd17-4e70-85c0-1a6dd541906c'));
    await evaluate(ready);
    const check=await evaluate(`const cc=await System.import('cc'),s=cc.director.getScene(),g=s.getComponentInChildren(cc.js.getClassByName('数字门玩法'));cc.game.pause();g.music.stop();
    cc.profiler.hideStats();cc.game.step();cc.game.pause();
    return {camera:{position:g.camera.node.position,rotation:g.camera.node.eulerAngles,fov:g.camera.fov},gates:g.gates.map(v=>({side:v.side,x:v.node.position.x,z:v.z})),enemies:g.enemies.length,roadMeshes:s.getChildByName('地形').getComponentsInChildren(cc.MeshRenderer).length};`);
    await capture('game');
    console.log(JSON.stringify({camera:check.camera,gates:check.gates.length,enemies:check.enemies,roadMeshes:check.roadMeshes}));
    const tests=await evaluate(`const cc=await System.import('cc'),s=cc.director.getScene(),g=s.getComponentInChildren(cc.js.getClassByName('数字门玩法'));
    const passed=[],assert=(v,name)=>{if(!v)throw Error(name);passed.push(name);};
    const root=s.getChildByName('地形').getChildByName('连续S弯道路');
    assert(root.children[0].children.every(n=>Math.abs(n.scale.x*10-3.79)<1e-6),'中路每一段保持原宽3.79');
    assert(root.children[1].children.every(n=>Math.abs(n.scale.x*10-2.8)<1e-6),'左路每一段保持原宽2.8');
    const stub=s.getChildByName('地形').getChildByName('Plane-002');
    assert(Math.abs(stub.scale.x*10-2.8)<1e-6&&Math.abs(stub.scale.z*10-3)<1e-6,'右路保持原宽2.8且只有3米');
    assert(g.gates.filter(v=>v.side===1).every(v=>v.z>=.309),'右侧开场队列位于短路段内');
    g.begin();g.sound=()=>{};g.music.stop();
    const before=g.enemies.find(a=>!a.boss&&a.node.position.z<-20),x=before.node.position.x;
    for(let i=0;i<600;i++)g.updateEnemies(.05);
    assert(Math.abs(before.node.position.x-x)>.1,'远处敌人随S弯横向移动');
    const path=g.cfg.paths.obstacles;
    function routeX(z){for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i];if(z<=b.z)return a.x+(b.x-a.x)*(z-a.z)/(b.z-a.z);}return path[path.length-1].x;}
    assert(g.enemies.filter(a=>!a.chasing).every(a=>Math.abs(a.node.position.x-routeX(a.node.position.z))<1.5),'普通敌人和Boss移动后仍在中路围栏内');
    for(const r of [...g.rewards].filter(r=>r.kind==='plane')){r.node.destroy();g.rewards.splice(g.rewards.indexOf(r),1);}
    g.cfg=structuredClone(g.cfg);g.cfg.gateSpeed=2;
    for(let i=0;i<100;i++)g.updateGateLane(.05,1);
    assert(g.gates.filter(v=>v.side===1).every(v=>v.z>=.309),'右侧续生门不会出现在短路段外');
    g.restart();cc.game.pause();return passed;`);
    console.log(JSON.stringify({tests}));
    await evaluate(`const cc=await System.import('cc'),s=cc.director.getScene(),g=s.getComponentInChildren(cc.js.getClassByName('数字门玩法'));g.enabled=false;s.getChildByName('Canvas-游戏UI').active=false;g.world.active=false;
    g.camera.node.setPosition(-3,90,-8);g.camera.node.setRotationFromEuler(-70,0,0);g.camera.projection=cc.Camera.ProjectionType.ORTHO;g.camera.orthoHeight=64;cc.game.step();cc.game.pause();return true;`);
    await capture('overview');
    const logs=await editorCall('execute_javascript',{context:'editor',code:`return require('electron').BrowserWindow.fromId(${id}).roadLogs;`});
    await fs.writeFile(`${output}/checks.json`,JSON.stringify({check,tests,logs},null,2));
    console.log(JSON.stringify({output,logs}));
} finally {await editorCall('execute_javascript',{context:'editor',code:`require('electron').BrowserWindow.fromId(${id})?.destroy();return true;`});}
