import fs from 'node:fs/promises';
import sharp from 'sharp';
import { editorCall } from './editor-bridge-client.mjs';
const output='tools/coin-reference';
const id=await editorCall('execute_javascript',{context:'editor',code:`
const address=await Editor.Message.request('preview','query-preview-url'),url=new URL(typeof address==='string'?address:address.url);url.hostname='127.0.0.1';
const win=new (require('electron').BrowserWindow)({show:false,width:900,height:1200,webPreferences:{offscreen:true,backgroundThrottling:false}});win.coinLogs=[];win.webContents.on('console-message',(_e,l,m)=>{if(l>=2)win.coinLogs.push(m);});await win.loadURL(url.href);return win.id;`});
const evaluate=code=>editorCall('execute_javascript',{context:'editor',code:`const win=require('electron').BrowserWindow.fromId(${id});try{return await win.webContents.executeJavaScript(${JSON.stringify(`(async()=>{${code}})()`)});}catch(e){throw Error(e.message+' '+win.coinLogs.slice(-10).join(' | '));}`},60000);
const capture=async name=>{const p=await editorCall('execute_javascript',{context:'editor',code:`return (await require('electron').BrowserWindow.fromId(${id}).webContents.capturePage()).toPNG().toString('base64');`});const b=Buffer.from(p,'base64'),m=await sharp(b).metadata();await sharp(b).extract({left:75,top:50,width:750,height:m.height-50}).png().toFile(`${output}/${name}.png`);};
try{
 const ready=(await fs.readFile('tools/prepare-bake-preview.js','utf8')).replace('EXPECTED_SCENE',JSON.stringify('e26a1c6f-fd17-4e70-85c0-1a6dd541906c'));await evaluate(ready);
 const info=await evaluate(`const cc=await System.import('cc'),g=cc.director.getScene().getComponentInChildren(cc.js.getClassByName('数字门玩法'));cc.game.pause();g.music.stop();return {coin:g.coinMode,build:g.coinBuild?.snapshot(),left:g.gates.filter(v=>v.side<0).length,right:g.gates.filter(v=>v.side>0).length,obstacle:g.coinBuild?.obstacle?.name};`);console.log(JSON.stringify(info));await capture('coin-opening');
 const tests=await evaluate(`const cc=await System.import('cc'),g=cc.director.getScene().getComponentInChildren(cc.js.getClassByName('数字门玩法')),b=g.coinBuild;const p=[],a=(v,n)=>{if(!v)throw Error(n);p.push(n);};g.sound=()=>{};g.begin();g.enemies.forEach(e=>{e.node.setPosition(0,0,-100);e.speed=0;});
 for(let i=0;i<60;i++)g.update(.05);a(b.snapshot().obstacleReady,'金币雕塑升起完成');a(g.gates.filter(v=>v.side>0).length===0,'右侧没有数字门');a(b.snapshot().defenses.length===0,'开场没有炮塔');
 b.host.settings.pickupRadius=10;b.scatterCoins(new cc.Vec3(g.squad.position.x,.4,g.squad.position.z),100);const afterScatter=b.snapshot();for(let i=0;i<80;i++)g.update(.05);a(b.snapshot().stats.earned>0,'玩家靠近后可收集金币 '+JSON.stringify({afterScatter,after:b.snapshot()}));
 for(let i=0;i<120;i++)g.update(.05);a(b.snapshot().stats.spent>0,'金币会自动投入中路建造区');
 for(let i=0;i<260;i++)g.update(.05);a(b.snapshot().defenses.length===1&&b.snapshot().stats.built===1,'投满100金币生成第一座炮台 '+JSON.stringify(b.snapshot()));
 const first=b.liveDefenses[0];for(let i=0;i<30;i++)g.update(.05);a(b.snapshot().stats.shots>0,'炮台发射子弹');b.destroyDefense(first);for(let i=0;i<35;i++)g.update(.05);a(b.snapshot().debris===0&&b.snapshot().stats.destroyed===1,'炮台被击中后碎裂并消失');
 b.scatterCoins(new cc.Vec3(g.squad.position.x,.4,g.squad.position.z),200);for(let i=0;i<320;i++)g.update(.05);a(b.snapshot().defenses.length===1&&b.snapshot().stats.built===2,'第二份金币生成第二座炮台');return p;`);console.log(JSON.stringify({tests}));await capture('coin-built');
 const logs=await editorCall('execute_javascript',{context:'editor',code:`return require('electron').BrowserWindow.fromId(${id}).coinLogs;`});await fs.writeFile(`${output}/coin-checks.json`,JSON.stringify({info,tests,logs},null,2));console.log(JSON.stringify({logs}));
}finally{await editorCall('execute_javascript',{context:'editor',code:`require('electron').BrowserWindow.fromId(${id})?.destroy();return true;`});}
